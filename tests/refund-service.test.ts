import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/copper/refunds", () => ({
  readOrder: vi.fn(),
  readLimitCents: vi.fn(),
  readOpenRefundForOrder: vi.fn(),
  createRefund: vi.fn(),
  markOrderRefunded: vi.fn(),
  decidePendingRefund: vi.fn(),
}));

import * as db from "@/lib/copper/refunds";
import { decideAsHuman, requestRefund } from "@/lib/copper/refund-service";

const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const order = {
  id: "1003",
  customer_name: "Priya Shah",
  items: "Copper Home (Night Sky)",
  amount_cents: 14900,
  ordered_at: recent,
  refunded: false,
};
const savedRow = (over: object = {}) => ({
  id: "r1",
  order_id: "1003",
  amount_cents: 3500,
  reason: "",
  status: "approved",
  decided_by: "auto",
  reviewer_note: null,
  created_at: recent,
  decided_at: recent,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.readOrder).mockResolvedValue(order);
  vi.mocked(db.readLimitCents).mockResolvedValue(5000);
  vi.mocked(db.readOpenRefundForOrder).mockResolvedValue("none");
  vi.mocked(db.createRefund).mockImplementation(async (input) =>
    savedRow({
      status: input.status,
      decided_by: input.decidedBy,
      amount_cents: input.amountCents,
      reviewer_note: input.reviewerNote,
    }) as never,
  );
  vi.mocked(db.markOrderRefunded).mockResolvedValue(true);
});

describe("requestRefund", () => {
  it("RA-6: approves an amount under the limit and records it as decided by auto", async () => {
    const result = await requestRefund({ orderId: "1003", amountCents: 3500, reason: "x" });
    expect(result.status).toBe("approved");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", decidedBy: "auto" }),
    );
    expect(db.markOrderRefunded).toHaveBeenCalledWith("1003");
  });

  it("RA-5: an amount over the limit is saved as pending, never approved", async () => {
    const result = await requestRefund({ orderId: "1003", amountCents: 12000, reason: "x" });
    expect(result.status).toBe("pending");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", decidedBy: null }),
    );
    expect(db.markOrderRefunded).not.toHaveBeenCalled();
  });

  it("tells the customer a refund specialist will review it as soon as possible, without the limit or the reason", async () => {
    const result = await requestRefund({ orderId: "1003", amountCents: 12000, reason: "x" });
    expect(result.message).toMatch(/passed to a refund specialist/i);
    expect(result.message).toMatch(/as soon as possible/i);
    expect(result.message).toContain("$120.00");
    expect(result.message).not.toMatch(/limit/i);
    expect(result.message).not.toMatch(/\$50/);
  });

  it("with no amount given, refunds the full amount paid (a big order waits for a person)", async () => {
    const result = await requestRefund({ orderId: "1003", reason: "It stopped working" });
    expect(result.status).toBe("pending");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 14900, status: "pending" }),
    );
    expect(result.message).toContain("$149.00");
  });

  it("with no amount given, a small order is refunded in full automatically", async () => {
    vi.mocked(db.readOrder).mockResolvedValue({ ...order, id: "1001", amount_cents: 799 });
    const result = await requestRefund({ orderId: "1001", reason: "Not needed" });
    expect(result.status).toBe("approved");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 799, status: "approved", decidedBy: "auto" }),
    );
    expect(result.message).toContain("$7.99");
  });

  it("a named amount still wins over the default (a partial refund)", async () => {
    const result = await requestRefund({ orderId: "1003", amountCents: 3000, reason: "Partly broken" });
    expect(result.status).toBe("approved");
    expect(db.createRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 3000 }));
  });

  it("with no amount given, an already refunded order is still rejected", async () => {
    vi.mocked(db.readOrder).mockResolvedValue({ ...order, refunded: true });
    const result = await requestRefund({ orderId: "1003", reason: "Again" });
    expect(result.status).toBe("rejected");
  });

  it("RA-5: the limit comes from the database, so a changed limit changes the result", async () => {
    vi.mocked(db.readLimitCents).mockResolvedValue(20000);
    const result = await requestRefund({ orderId: "1003", amountCents: 12000, reason: "x" });
    expect(result.status).toBe("approved");
  });

  it("RA-6: rejects an already refunded order and records it as decided by rules", async () => {
    vi.mocked(db.readOrder).mockResolvedValue({ ...order, refunded: true });
    const result = await requestRefund({ orderId: "1003", amountCents: 500, reason: "x" });
    expect(result.status).toBe("rejected");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", decidedBy: "rules" }),
    );
  });

  it("RA-2: a nonsense amount is rejected and not saved", async () => {
    const result = await requestRefund({ orderId: "1003", amountCents: -5, reason: "x" });
    expect(result.status).toBe("rejected");
    expect(db.createRefund).not.toHaveBeenCalled();
  });

  it("doesn't stack a second request while one is waiting", async () => {
    vi.mocked(db.readOpenRefundForOrder).mockResolvedValue(
      savedRow({ status: "pending" }) as never,
    );
    const result = await requestRefund({ orderId: "1003", amountCents: 500, reason: "x" });
    expect(result.status).toBe("pending");
    expect(result.message).toMatch(/already with a refund specialist/i);
    expect(result.message).toMatch(/as soon as possible/i);
    expect(db.createRefund).not.toHaveBeenCalled();
  });

  it("says so when the order doesn't exist", async () => {
    vi.mocked(db.readOrder).mockResolvedValue("not_found");
    const result = await requestRefund({ orderId: "9999", amountCents: 500, reason: "x" });
    expect(result.status).toBe("not_found");
  });

  it("RA-17: says refunds can't be checked when the database can't be read", async () => {
    vi.mocked(db.readOrder).mockResolvedValue(null);
    const result = await requestRefund({ orderId: "1003", amountCents: 500, reason: "x" });
    expect(result.status).toBe("unavailable");
    expect(db.createRefund).not.toHaveBeenCalled();
  });

  it("never approves when the limit can't be read", async () => {
    vi.mocked(db.readLimitCents).mockResolvedValue(null);
    const result = await requestRefund({ orderId: "1003", amountCents: 100, reason: "x" });
    expect(result.status).toBe("unavailable");
  });
});

describe("decideAsHuman", () => {
  it("RA-11: approving saves the decision and marks the order refunded", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue(
      savedRow({ status: "approved", decided_by: "human" }) as never,
    );
    const result = await decideAsHuman("r1", { action: "approve" });
    expect(result.ok).toBe(true);
    expect(db.decidePendingRefund).toHaveBeenCalledWith("r1", {
      status: "approved",
      note: null,
    });
    expect(db.markOrderRefunded).toHaveBeenCalledWith("1003");
  });

  it("RA-12: rejecting without a reason is refused and nothing is saved", async () => {
    for (const reason of ["", "   "]) {
      const result = await decideAsHuman("r1", { action: "reject", reason });
      expect(result.ok).toBe(false);
    }
    expect(db.decidePendingRefund).not.toHaveBeenCalled();
  });

  it("RA-12: rejecting with a reason saves it", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue(
      savedRow({ status: "rejected", decided_by: "human" }) as never,
    );
    const result = await decideAsHuman("r1", { action: "reject", reason: " Past the window " });
    expect(result.ok).toBe(true);
    expect(db.decidePendingRefund).toHaveBeenCalledWith("r1", {
      status: "rejected",
      note: "Past the window",
    });
    expect(db.markOrderRefunded).not.toHaveBeenCalled();
  });

  it("RA-13: a refund that is no longer pending can't be decided again", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue("not_pending");
    const result = await decideAsHuman("r1", { action: "approve" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("already decided") });
    expect(db.markOrderRefunded).not.toHaveBeenCalled();
  });

  it("RA-17: says so when the decision can't be saved", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue(null);
    const result = await decideAsHuman("r1", { action: "approve" });
    expect(result.ok).toBe(false);
  });
});
