import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRefund,
  decidePendingRefund,
  listRefunds,
  markOrderRefunded,
  readLatestRefundForOrder,
  readLimitCents,
  readOrder,
  saveLimitCents,
} from "@/lib/copper/refunds";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refund data without Supabase", () => {
  it("RA-17: every function says 'can't' instead of crashing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(await readOrder("1001")).toBeNull();
    expect(await readLimitCents()).toBeNull();
    expect(await readLatestRefundForOrder("1001")).toBeNull();
    expect(await listRefunds()).toBeNull();
    expect(await markOrderRefunded("1001")).toBe(false);
    expect(await saveLimitCents(5000)).toBe(false);
    expect(
      await createRefund({
        orderId: "1001",
        amountCents: 100,
        reason: "",
        status: "pending",
        decidedBy: null,
        reviewerNote: null,
      }),
    ).toBeNull();
    expect(
      await decidePendingRefund("r1", { status: "approved", note: null }),
    ).toBeNull();
  });
});
