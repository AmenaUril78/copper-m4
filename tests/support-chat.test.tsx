import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLive } from "@/lib/ai/live";
import type { SupportProgress } from "@/lib/copper/assistant/support";

const { askSupport } = vi.hoisted(() => ({ askSupport: vi.fn() }));
vi.mock("@/lib/copper/assistant/support", () => ({ askSupport }));

import { SupportChat } from "@/components/copper/support-chat";

function answered(reply: string, mode: SupportProgress["mode"], steps: SupportProgress["steps"] = []) {
  const live = createLive<SupportProgress>();
  live.done({ steps, reply, status: "done", mode });
  return { progress: live.live };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const send = (text: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: /your message/i }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
};

describe("SupportChat", () => {
  it("starts with Copper in charge and offers a Request a refund button", () => {
    render(<SupportChat />);
    expect(screen.getByTestId("support-mode")).toHaveTextContent("Copper (shopping)");
    expect(screen.getByRole("button", { name: /request a refund/i })).toBeInTheDocument();
  });

  it("RA-7: the button starts a refund chat by sending mode refund", async () => {
    askSupport.mockResolvedValue(answered("What is your order number?", "refund"));
    render(<SupportChat />);
    fireEvent.click(screen.getByRole("button", { name: /request a refund/i }));
    await waitFor(() => expect(askSupport).toHaveBeenCalledTimes(1));
    expect(askSupport.mock.calls[0][0]).toEqual({
      messages: [{ role: "user", content: "I'd like to request a refund." }],
      mode: "refund",
    });
    expect(await screen.findByText("What is your order number?")).toBeInTheDocument();
  });

  it("RA-8: after a hand-off the next message is sent in refund mode, and the badge says so", async () => {
    askSupport
      .mockResolvedValueOnce(answered("A specialist is taking over.", "refund", [
        { type: "tool", id: "c1", name: "hand_off_to_refund_agent", state: "done", input: {}, output: { handedOff: true } },
      ]))
      .mockResolvedValueOnce(answered("Thanks. Checking now.", "refund"));
    render(<SupportChat />);
    send("I want a refund");
    expect(await screen.findByText("A specialist is taking over.")).toBeInTheDocument();
    expect(screen.getByText(/chat passed to the refund assistant/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("support-mode")).toHaveTextContent("Refund assistant"),
    );
    // The button is hidden while the refund agent has the chat.
    expect(screen.queryByRole("button", { name: /request a refund/i })).toBeNull();

    send("Order 1001");
    await waitFor(() => expect(askSupport).toHaveBeenCalledTimes(2));
    expect(askSupport.mock.calls[1][0].mode).toBe("refund");
    expect(askSupport.mock.calls[1][0].messages).toHaveLength(3);
  });

  it("shows refund tool calls as a labelled list, never raw JSON", async () => {
    askSupport.mockResolvedValue(
      answered("Your refund of $7.99 is approved.", "shopping", [
        { type: "tool", id: "c1", name: "lookup_order", state: "done", input: { orderId: "1001" },
          output: { status: "ok", order: { id: "1001", items: "Copper Plus, monthly", paidUsd: "$7.99", orderedAt: "2026-11-13T12:00:00Z", alreadyRefunded: false } } },
        { type: "tool", id: "c2", name: "request_refund", state: "done", input: { orderId: "1001", amountUsd: 7.99, reason: "Not needed" },
          output: { status: "approved", refundId: "r1", message: "Your refund of $7.99 is approved." } },
      ]),
    );
    render(<SupportChat />);
    send("refund order 1001");
    const cards = await screen.findAllByTestId("tool-call");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-tool", "lookup_order");
    expect(within(cards[0]).getByText("Copper Plus, monthly")).toBeInTheDocument();
    expect(within(cards[1]).getAllByText(/\$7\.99/).length).toBeGreaterThan(0);
    expect(cards[1].textContent).not.toContain("{");
  });

  it("numbers tool cards from 1: the hand-off notice doesn't take a number", async () => {
    askSupport.mockResolvedValue(
      answered("Found it.", "refund", [
        { type: "tool", id: "c0", name: "hand_off_to_refund_agent", state: "done", input: {}, output: { handedOff: true } },
        { type: "tool", id: "c1", name: "lookup_order", state: "done", input: { orderId: "1001" },
          output: { status: "ok", order: { id: "1001", latestRefund: null } } },
        { type: "tool", id: "c2", name: "request_refund", state: "done", input: { orderId: "1001", amountUsd: 7.99, reason: "x" },
          output: { status: "approved", message: "ok" } },
      ]),
    );
    render(<SupportChat />);
    send("refund order 1001");
    const cards = await screen.findAllByTestId("tool-call");
    expect(within(cards[0]).getByText("tool 1")).toBeInTheDocument();
    expect(within(cards[1]).getByText("tool 2")).toBeInTheDocument();
  });

  it("shows an order's latest refund in the lookup card without crashing", async () => {
    askSupport.mockResolvedValue(
      answered("A team member is still reviewing it.", "refund", [
        { type: "tool", id: "c1", name: "lookup_order", state: "done", input: { orderId: "1003" },
          output: { status: "ok", order: { id: "1003", items: "Copper Home", paidUsd: "$149.00", alreadyRefunded: false,
            latestRefund: { refundId: "r1", refundStatus: "pending", amountUsd: "$149.00", decidedBy: null, reviewerNote: null } } } },
      ]),
    );
    render(<SupportChat />);
    send("what happened with order 1003?");
    const card = await screen.findByTestId("tool-call");
    expect(within(card).getByText("pending")).toBeInTheDocument();
  });

  it("falls back to a polite message when the action fails", async () => {
    askSupport.mockRejectedValue(new Error("boom"));
    render(<SupportChat />);
    send("hello");
    expect(await screen.findByText(/couldn't answer that just now/i)).toBeInTheDocument();
  });

  it("doesn't send a blank message", () => {
    render(<SupportChat />);
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });
});
