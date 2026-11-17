import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/copper/refunds", () => ({
  readOrder: vi.fn(),
  readRefund: vi.fn(),
  readLatestRefundForOrder: vi.fn(),
  readLimitCents: vi.fn(),
  readOpenRefundForOrder: vi.fn(),
  createRefund: vi.fn(),
  markOrderRefunded: vi.fn(),
  decidePendingRefund: vi.fn(),
}));

import {
  checkRefundStatus,
  checkRefundStatusInput,
  lookupOrder,
  lookupOrderInput,
  REFUND_INSTRUCTIONS,
  refundTools,
  requestRefundInput,
  requestRefundTool,
} from "@/lib/copper/assistant/refund-agent";
import {
  looksLikeRefundRequest,
  SUPPORT_INSTRUCTIONS,
  supportTools,
} from "@/lib/copper/assistant/handoff";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import { copperTools } from "@/lib/copper/assistant/tools";
import * as db from "@/lib/copper/refunds";

beforeEach(() => vi.resetAllMocks());

describe("the tools each agent has", () => {
  it("RA-9: the Refund agent has exactly four tools, each with a description", () => {
    expect(Object.keys(refundTools).sort()).toEqual([
      "check_refund_status",
      "hand_back_to_copper",
      "lookup_order",
      "request_refund",
    ]);
    for (const tool of Object.values(refundTools)) {
      expect(tool.description?.length).toBeGreaterThan(10);
    }
  });

  it("RA-9: Ask Copper's own tools are untouched, and the support chat adds only the hand-off", () => {
    expect(Object.keys(copperTools)).toHaveLength(4);
    expect(Object.keys(supportTools).sort()).toEqual([
      ...Object.keys(copperTools),
      "hand_off_to_refund_agent",
    ].sort());
    for (const name of Object.keys(refundTools)) {
      expect(supportTools).not.toHaveProperty(name);
    }
  });
});

describe("tool inputs", () => {
  it("RA-5: request_refund has no limit input, and rejects one if the model sends it", () => {
    expect(Object.keys(requestRefundInput.shape).sort()).toEqual([
      "amountUsd",
      "orderId",
      "reason",
    ]);
    const withLimit = {
      orderId: "1003",
      amountUsd: 100,
      reason: "broken",
      limitCents: 999999,
    };
    expect(requestRefundInput.safeParse(withLimit).success).toBe(false);
  });

  it.each([0, -5, 12.345, 20000, "35"])("rejects the amount %s", (amountUsd) => {
    const result = requestRefundInput.safeParse({
      orderId: "1003",
      amountUsd,
      reason: "broken",
    });
    expect(result.success).toBe(false);
  });

  it("accepts dollars and cents", () => {
    const result = requestRefundInput.safeParse({
      orderId: "1003",
      amountUsd: 35.5,
      reason: "broken",
    });
    expect(result.success).toBe(true);
  });

  it("needs a reason and an order number made of digits", () => {
    expect(
      requestRefundInput.safeParse({ orderId: "1003", amountUsd: 5, reason: " " }).success,
    ).toBe(false);
    expect(lookupOrderInput.safeParse({ orderId: "abc" }).success).toBe(false);
    expect(lookupOrderInput.safeParse({ orderId: "1003; drop" }).success).toBe(false);
    expect(lookupOrderInput.safeParse({ orderId: "1003" }).success).toBe(true);
  });

  it("check_refund_status needs a real refund id", () => {
    expect(checkRefundStatusInput.safeParse({ refundId: "nope" }).success).toBe(false);
    expect(
      checkRefundStatusInput.safeParse({
        refundId: "123e4567-e89b-42d3-a456-426614174000",
      }).success,
    ).toBe(true);
  });
});

describe("tool results", () => {
  it("lookup_order shows the order in dollars", async () => {
    vi.mocked(db.readOrder).mockResolvedValue({
      id: "1003",
      customer_name: "Priya Shah",
      items: "Copper Home (Night Sky)",
      amount_cents: 14900,
      ordered_at: "2026-11-10T12:00:00Z",
      refunded: false,
    });
    vi.mocked(db.readLatestRefundForOrder).mockResolvedValue("none");
    const result = await lookupOrder({ orderId: "1003" });
    expect(result).toMatchObject({
      status: "ok",
      order: {
        id: "1003",
        paidUsd: "$149.00",
        alreadyRefunded: false,
        latestRefund: null,
      },
    });
    // No customer name goes to the model.
    expect(JSON.stringify(result)).not.toContain("Priya");
  });

  const order1003 = {
    id: "1003",
    customer_name: "Priya Shah",
    items: "Copper Home (Night Sky)",
    amount_cents: 14900,
    ordered_at: "2026-11-10T12:00:00Z",
    refunded: false,
  };
  const refundRow = (over: object) =>
    ({
      id: "123e4567-e89b-42d3-a456-426614174000",
      order_id: "1003",
      amount_cents: 14900,
      reason: "It stopped working",
      status: "rejected",
      decided_by: "human",
      reviewer_note: "Please contact the Copper Crew first.",
      created_at: "2026-11-10T12:00:00Z",
      decided_at: "2026-11-11T12:00:00Z",
      ...over,
    }) as never;

  it("RA-16: lookup_order shows the latest refund, with a rejection's reason", async () => {
    vi.mocked(db.readOrder).mockResolvedValue(order1003);
    vi.mocked(db.readLatestRefundForOrder).mockResolvedValue(refundRow({}));
    const result = await lookupOrder({ orderId: "1003" });
    expect(result).toMatchObject({
      status: "ok",
      order: {
        latestRefund: {
          refundStatus: "rejected",
          amountUsd: "$149.00",
          decidedBy: "human",
          reviewerNote: "Please contact the Copper Crew first.",
        },
      },
    });
  });

  it("RA-16: lookup_order shows a refund that is still waiting", async () => {
    vi.mocked(db.readOrder).mockResolvedValue(order1003);
    vi.mocked(db.readLatestRefundForOrder).mockResolvedValue(
      refundRow({ status: "pending", decided_by: null, reviewer_note: null, decided_at: null }),
    );
    const result = await lookupOrder({ orderId: "1003" });
    expect(result).toMatchObject({
      order: { latestRefund: { refundStatus: "pending", reviewerNote: null } },
    });
  });

  it("lookup_order says unavailable if the refund can't be read, and never guesses", async () => {
    vi.mocked(db.readOrder).mockResolvedValue(order1003);
    vi.mocked(db.readLatestRefundForOrder).mockResolvedValue(null);
    expect((await lookupOrder({ orderId: "1003" })).status).toBe("unavailable");
  });

  it("lookup_order says when the order doesn't exist or can't be read", async () => {
    vi.mocked(db.readOrder).mockResolvedValueOnce("not_found");
    expect((await lookupOrder({ orderId: "9" })).status).toBe("not_found");
    vi.mocked(db.readOrder).mockResolvedValueOnce(null);
    expect((await lookupOrder({ orderId: "9" })).status).toBe("unavailable");
  });

  it("request_refund turns dollars into whole cents before the rules see them", async () => {
    vi.mocked(db.readOrder).mockResolvedValue({
      id: "1003",
      customer_name: "x",
      items: "x",
      amount_cents: 14900,
      ordered_at: new Date().toISOString(),
      refunded: false,
    });
    vi.mocked(db.readLimitCents).mockResolvedValue(5000);
    vi.mocked(db.readOpenRefundForOrder).mockResolvedValue("none");
    vi.mocked(db.createRefund).mockResolvedValue({ id: "r1" } as never);
    vi.mocked(db.markOrderRefunded).mockResolvedValue(true);
    const result = await requestRefundTool({
      orderId: "1003",
      amountUsd: 7.99,
      reason: "no longer needed",
    });
    expect(result.status).toBe("approved");
    expect(db.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 799 }),
    );
  });

  it("RA-16: check_refund_status returns the status and the reviewer's reason", async () => {
    vi.mocked(db.readRefund).mockResolvedValue({
      id: "r1",
      order_id: "1003",
      amount_cents: 12000,
      reason: "",
      status: "rejected",
      decided_by: "human",
      reviewer_note: "Outside the return window.",
      created_at: "2026-11-10T12:00:00Z",
      decided_at: "2026-11-11T12:00:00Z",
    });
    const result = await checkRefundStatus({
      refundId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(result).toMatchObject({
      status: "ok",
      refundStatus: "rejected",
      amountUsd: "$120.00",
      reviewerNote: "Outside the return window.",
    });
  });
});

describe("the instructions", () => {
  it("RA-10: neither agent's instructions state a dollar limit", () => {
    for (const text of [REFUND_INSTRUCTIONS, SUPPORT_INSTRUCTIONS]) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toMatch(/\b50\b/);
      expect(text.toLowerCase()).toMatch(/never mention or guess any refund limit/);
    }
  });

  it("RA-16: the Refund agent is told to read an order's latest refund and give a rejection's reason", () => {
    expect(REFUND_INSTRUCTIONS).toMatch(/latestRefund/);
    expect(REFUND_INSTRUCTIONS).toMatch(/reason exactly as the tool gives it/i);
    expect(REFUND_INSTRUCTIONS).toMatch(/don't make a new request for an order that already has a pending one/i);
  });

  it("the Refund agent is told not to decide for itself and not to promise", () => {
    expect(REFUND_INSTRUCTIONS).toMatch(/never decide yourself/i);
    expect(REFUND_INSTRUCTIONS).toMatch(/never say a refund is approved/i);
  });

  it("the support instructions keep Ask Copper's own rules and add the hand-off", () => {
    expect(SUPPORT_INSTRUCTIONS.startsWith(COPPER_INSTRUCTIONS)).toBe(true);
    expect(SUPPORT_INSTRUCTIONS).toContain("hand_off_to_refund_agent");
  });
});

describe("the refund safety net", () => {
  it.each([
    "I want a refund for order 1042",
    "Can I get my money back?",
    "please REFUND me",
    "I need to be reimbursed",
  ])("catches: %s", (text) => {
    expect(looksLikeRefundRequest(text)).toBe(true);
  });

  it.each(["How much is Copper Home?", "Is Night Sky in stock?", "Tell me about plans"])(
    "ignores: %s",
    (text) => {
      expect(looksLikeRefundRequest(text)).toBe(false);
    },
  );
});
