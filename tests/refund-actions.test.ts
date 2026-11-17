import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/copper/refunds", () => ({
  readOrder: vi.fn(),
  readLimitCents: vi.fn(),
  listRefunds: vi.fn(),
  readOpenRefundForOrder: vi.fn(),
  createRefund: vi.fn(),
  markOrderRefunded: vi.fn(),
  decidePendingRefund: vi.fn(),
  saveLimitCents: vi.fn(),
}));

import {
  approveRefund,
  changeLimit,
  loadRefundConsole,
  rejectRefund,
} from "@/lib/copper/refund-actions";
import * as db from "@/lib/copper/refunds";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const decided = (status: string) =>
  ({
    id: ID,
    order_id: "1003",
    amount_cents: 12000,
    reason: "",
    status,
    decided_by: "human",
    reviewer_note: null,
    created_at: "2026-11-10T12:00:00Z",
    decided_at: "2026-11-11T12:00:00Z",
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.markOrderRefunded).mockResolvedValue(true);
  vi.mocked(db.saveLimitCents).mockResolvedValue(true);
});

describe("approveRefund", () => {
  it("RA-11: approves a pending refund", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue(decided("approved"));
    expect(await approveRefund({ id: ID })).toEqual({ ok: true });
  });

  it("refuses a bad id or extra fields without touching the database", async () => {
    const bad = await approveRefund({ id: "nope" });
    expect(bad.ok).toBe(false);
    const extra = await approveRefund({ id: ID, status: "approved" } as never);
    expect(extra.ok).toBe(false);
    expect(db.decidePendingRefund).not.toHaveBeenCalled();
  });

  it("RA-13: says so when the refund was already decided", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue("not_pending");
    const result = await approveRefund({ id: ID });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("already decided") });
  });
});

describe("rejectRefund", () => {
  it.each(["", "   "])("RA-12: refuses a reject with the reason %j", async (reason) => {
    const result = await rejectRefund({ id: ID, reason });
    expect(result.ok).toBe(false);
    expect(db.decidePendingRefund).not.toHaveBeenCalled();
  });

  it("RA-12: saves a reject that has a reason", async () => {
    vi.mocked(db.decidePendingRefund).mockResolvedValue(decided("rejected"));
    expect(await rejectRefund({ id: ID, reason: "Outside the window" })).toEqual({ ok: true });
    expect(db.decidePendingRefund).toHaveBeenCalledWith(ID, {
      status: "rejected",
      note: "Outside the window",
    });
  });

  it("refuses a reason that is far too long", async () => {
    const result = await rejectRefund({ id: ID, reason: "x".repeat(501) });
    expect(result.ok).toBe(false);
  });
});

describe("changeLimit", () => {
  it("RA-14: saves a sensible limit", async () => {
    expect(await changeLimit({ limitCents: 7500 })).toEqual({ ok: true });
    expect(db.saveLimitCents).toHaveBeenCalledWith(7500);
  });

  it.each([0, -100, 12.5, 100001, Number.NaN])("RA-14: refuses %s", async (limitCents) => {
    const result = await changeLimit({ limitCents });
    expect(result.ok).toBe(false);
    expect(db.saveLimitCents).not.toHaveBeenCalled();
  });

  it("refuses extra fields and non-numbers", async () => {
    expect((await changeLimit({ limitCents: 5000, admin: true } as never)).ok).toBe(false);
    expect((await changeLimit({ limitCents: "5000" } as never)).ok).toBe(false);
  });

  it("says so when the limit can't be saved", async () => {
    vi.mocked(db.saveLimitCents).mockResolvedValue(false);
    expect((await changeLimit({ limitCents: 5000 })).ok).toBe(false);
  });
});

describe("loadRefundConsole", () => {
  it("returns every refund and the current limit", async () => {
    vi.mocked(db.listRefunds).mockResolvedValue([decided("pending")] as never);
    vi.mocked(db.readLimitCents).mockResolvedValue(5000);
    expect(await loadRefundConsole()).toEqual({
      status: "ok",
      refunds: [decided("pending")],
      limitCents: 5000,
    });
  });

  it("RA-17: says unavailable when either can't be read, and never throws", async () => {
    vi.mocked(db.listRefunds).mockResolvedValue(null);
    vi.mocked(db.readLimitCents).mockResolvedValue(5000);
    expect(await loadRefundConsole()).toEqual({ status: "unavailable" });
    vi.mocked(db.listRefunds).mockResolvedValue([]);
    vi.mocked(db.readLimitCents).mockResolvedValue(null);
    expect(await loadRefundConsole()).toEqual({ status: "unavailable" });
  });
});
