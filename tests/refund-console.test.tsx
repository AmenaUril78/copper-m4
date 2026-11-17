import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approveRefund, rejectRefund, changeLimit } = vi.hoisted(() => ({
  approveRefund: vi.fn(),
  rejectRefund: vi.fn(),
  changeLimit: vi.fn(),
}));
vi.mock("@/lib/copper/refund-actions", () => ({
  approveRefund,
  rejectRefund,
  changeLimit,
}));

import { RefundConsole } from "@/components/copper/refund-console";
import type { RefundWithOrder } from "@/lib/copper/refunds";

const refund = (over: Partial<RefundWithOrder>): RefundWithOrder => ({
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
  ...over,
});

beforeEach(() => {
  approveRefund.mockResolvedValue({ ok: true });
  rejectRefund.mockResolvedValue({ ok: true });
  changeLimit.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RefundConsole", () => {
  it("RA-11: lists pending refunds with the order, amount and the customer's reason", () => {
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} />);
    const card = screen.getByTestId("pending-refund");
    expect(within(card).getByText(/Order 1003 · \$120\.00/)).toBeInTheDocument();
    expect(within(card).getByText(/It stopped working/)).toBeInTheDocument();
    expect(within(card).getByText(/Priya Shah/)).toBeInTheDocument();
  });

  it("says when nothing is waiting", () => {
    render(<RefundConsole refunds={[]} limitCents={5000} />);
    expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/no refunds yet/i)).toBeInTheDocument();
  });

  it("RA-12: Reject stays disabled until a reason is written", () => {
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} />);
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /note for order 1003/i }), {
      target: { value: "   " },
    });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /note for order 1003/i }), {
      target: { value: "Past the return window" },
    });
    expect(reject).toBeEnabled();
  });

  it("RA-12: Reject sends the reason", async () => {
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} />);
    fireEvent.change(screen.getByRole("textbox", { name: /note for order 1003/i }), {
      target: { value: "Past the return window" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(rejectRefund).toHaveBeenCalledWith({
        id: "123e4567-e89b-42d3-a456-426614174000",
        reason: "Past the return window",
      }),
    );
  });

  it("RA-11: Approve works with no note", async () => {
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(approveRefund).toHaveBeenCalledWith({
        id: "123e4567-e89b-42d3-a456-426614174000",
        note: "",
      }),
    );
  });

  it("tells the panel to reload after a decision or a new limit is saved", async () => {
    const onChanged = vi.fn();
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /save limit/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it("doesn't reload when a decision is refused", async () => {
    approveRefund.mockResolvedValue({ ok: false, error: "Nope." });
    const onChanged = vi.fn();
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("alert");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the server's message when a decision is refused", async () => {
    approveRefund.mockResolvedValue({ ok: false, error: "This refund was already decided." });
    render(<RefundConsole refunds={[refund({})]} limitCents={5000} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already decided");
  });

  it("RA-14: shows the limit and saves a new one in cents", async () => {
    render(<RefundConsole refunds={[]} limitCents={5000} />);
    expect(screen.getByText(/up to \$50\.00 are approved automatically/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/new limit in dollars/i), {
      target: { value: "75.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save limit/i }));
    await waitFor(() => expect(changeLimit).toHaveBeenCalledWith({ limitCents: 7550 }));
    expect(await screen.findByText("Limit saved.")).toBeInTheDocument();
  });

  it("RA-14: shows why a limit was refused", async () => {
    changeLimit.mockResolvedValue({ ok: false, error: "The limit must be more than zero." });
    render(<RefundConsole refunds={[]} limitCents={5000} />);
    fireEvent.click(screen.getByRole("button", { name: /save limit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("more than zero");
  });

  it("RA-15: the log shows status, who decided, and the note or reason for every refund", () => {
    render(
      <RefundConsole
        limitCents={5000}
        refunds={[
          refund({}),
          refund({
            id: "a",
            order_id: "1001",
            amount_cents: 799,
            status: "approved",
            decided_by: "auto",
            decided_at: "2026-11-10T12:00:00Z",
          }),
          refund({
            id: "b",
            order_id: "1005",
            status: "rejected",
            decided_by: "human",
            reviewer_note: "Outside the return window.",
            decided_at: "2026-11-11T12:00:00Z",
          }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("log-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Auto (code approved)")).toBeInTheDocument();
    expect(within(rows[1]).getByText("$7.99")).toBeInTheDocument();
    expect(within(rows[2]).getByText("A person")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Outside the return window.")).toBeInTheDocument();
  });
});
