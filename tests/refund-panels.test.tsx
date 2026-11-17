import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { askSupport, loadRefundConsole } = vi.hoisted(() => ({
  askSupport: vi.fn(),
  loadRefundConsole: vi.fn(),
}));
vi.mock("@/lib/copper/assistant/support", () => ({ askSupport }));
vi.mock("@/lib/copper/refund-actions", () => ({
  loadRefundConsole,
  approveRefund: vi.fn(),
  rejectRefund: vi.fn(),
  changeLimit: vi.fn(),
}));

import { createLive } from "@/lib/ai/live";
import { RefundPanels } from "@/components/copper/refund-panels";

beforeEach(() => {
  loadRefundConsole.mockResolvedValue({
    status: "ok",
    limitCents: 5000,
    refunds: [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        order_id: "1003",
        amount_cents: 12000,
        reason: "It stopped working",
        status: "pending",
        decided_by: null,
        reviewer_note: null,
        created_at: "2026-11-10T12:00:00Z",
        decided_at: null,
        orders: { customer_name: "Priya Shah", items: "Copper Home (Night Sky)" },
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

const open = async () => {
  fireEvent.click(screen.getByTestId("support-launcher"));
  return screen.findByTestId("support-panel");
};

describe("Copper Support panel", () => {
  it("opens from the launcher and shows the two-agent chat", async () => {
    render(<RefundPanels aiConfigured supabaseConfigured />);
    const panel = within(await open());
    expect(panel.getByTestId("support-chat")).toBeInTheDocument();
    expect(panel.getByTestId("support-mode")).toHaveTextContent("Copper (shopping)");
    expect(panel.queryByText(/refunds aren't set up yet/i)).toBeNull();
  });

  it("RA-17: without an AI key it shows the setup card, not the chat", async () => {
    render(<RefundPanels aiConfigured={false} supabaseConfigured />);
    const panel = within(await open());
    expect(panel.getByText(/set up google ai/i)).toBeInTheDocument();
    expect(panel.queryByTestId("support-chat")).toBeNull();
  });

  it("RA-17: without Supabase the chat still opens, with a plain note about refunds", async () => {
    render(<RefundPanels aiConfigured supabaseConfigured={false} />);
    const panel = within(await open());
    expect(panel.getByText(/refunds aren't set up yet/i)).toBeInTheDocument();
    expect(panel.getByTestId("support-chat")).toBeInTheDocument();
  });

  it("keeps the conversation when the panel is closed and opened again", async () => {
    const live = createLive<never>();
    live.done({ steps: [], reply: "It is in stock.", status: "done", mode: "shopping" } as never);
    askSupport.mockResolvedValue({ progress: live.live });
    render(<RefundPanels aiConfigured supabaseConfigured />);
    const panel = within(await open());
    fireEvent.change(panel.getByRole("textbox", { name: /your message/i }), {
      target: { value: "Is Night Sky in stock?" },
    });
    fireEvent.click(panel.getByRole("button", { name: /^send$/i }));
    expect(await panel.findByText("It is in stock.")).toBeInTheDocument();

    fireEvent.click(panel.getByRole("button", { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByTestId("support-panel")).toBeNull());

    const again = within(await open());
    expect(again.getByText("Is Night Sky in stock?")).toBeInTheDocument();
    expect(again.getByText("It is in stock.")).toBeInTheDocument();
  });

  it("keeps the conversation when the staff link opens the console and you come back", async () => {
    const live = createLive<never>();
    live.done({ steps: [], reply: "Thanks, noted.", status: "done", mode: "shopping" } as never);
    askSupport.mockResolvedValue({ progress: live.live });
    render(<RefundPanels aiConfigured supabaseConfigured />);
    const support = within(await open());
    fireEvent.change(support.getByRole("textbox", { name: /your message/i }), {
      target: { value: "Hello Copper" },
    });
    fireEvent.click(support.getByRole("button", { name: /^send$/i }));
    await support.findByText("Thanks, noted.");

    fireEvent.click(support.getByRole("button", { name: /open the refund console/i }));
    const consolePanel = within(await screen.findByTestId("refund-console"));
    fireEvent.click(consolePanel.getByRole("button", { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByTestId("refund-console")).toBeNull());

    const back = within(await open());
    expect(back.getByText("Hello Copper")).toBeInTheDocument();
  });

  it("opens from /#support", async () => {
    window.history.replaceState(null, "", "/#support");
    render(<RefundPanels aiConfigured supabaseConfigured />);
    expect(await screen.findByTestId("support-panel")).toBeInTheDocument();
  });
});

describe("Refund Console panel", () => {
  it("opens from the support panel's staff link and loads the pending refunds", async () => {
    render(<RefundPanels aiConfigured supabaseConfigured />);
    const support = within(await open());
    fireEvent.click(support.getByRole("button", { name: /open the refund console/i }));
    const panel = within(await screen.findByTestId("refund-console"));
    expect(await panel.findByTestId("pending-refund")).toBeInTheDocument();
    expect(panel.getByText(/Order 1003 · \$120\.00/)).toBeInTheDocument();
    expect(panel.getByRole("note")).toHaveTextContent(/class demo only/i);
    expect(loadRefundConsole).toHaveBeenCalledTimes(1);
  });

  it("opens from /#refund-console", async () => {
    window.history.replaceState(null, "", "/#refund-console");
    render(<RefundPanels aiConfigured supabaseConfigured />);
    expect(await screen.findByTestId("refund-console")).toBeInTheDocument();
  });

  it("RA-17: without Supabase it explains what to set up and does not crash", async () => {
    window.history.replaceState(null, "", "/#refund-console");
    render(<RefundPanels aiConfigured supabaseConfigured={false} />);
    const panel = within(await screen.findByTestId("refund-console"));
    expect(panel.getByText(/set up supabase to use the console/i)).toBeInTheDocument();
    expect(loadRefundConsole).not.toHaveBeenCalled();
  });

  it("RA-17: says so when refunds can't be read", async () => {
    loadRefundConsole.mockResolvedValue({ status: "unavailable" });
    window.history.replaceState(null, "", "/#refund-console");
    render(<RefundPanels aiConfigured supabaseConfigured />);
    const panel = within(await screen.findByTestId("refund-console"));
    await waitFor(() =>
      expect(panel.getByText(/refunds can't be read right now/i)).toBeInTheDocument(),
    );
  });
});
