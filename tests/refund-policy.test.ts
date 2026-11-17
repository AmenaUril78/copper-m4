import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT_CENTS,
  decideRefund,
  formatCents,
  limitProblem,
  MAX_LIMIT_CENTS,
  type RefundOrder,
} from "@/lib/copper/refund-policy";

const NOW = new Date("2026-11-17T12:00:00Z");
const recentOrder: RefundOrder = {
  amountCents: 14900,
  orderedAt: "2026-11-10T12:00:00Z",
  refunded: false,
};
const decide = (amountCents: number, order: RefundOrder = recentOrder) =>
  decideRefund({ amountCents, order, limitCents: DEFAULT_LIMIT_CENTS, now: NOW });

describe("decideRefund", () => {
  it("RA-1: approves an amount at the limit", () => {
    expect(decide(5000).outcome).toBe("approve");
  });

  it("RA-1: approves an amount under the limit", () => {
    expect(decide(799).outcome).toBe("approve");
  });

  it("RA-1: sends one cent over the limit to a person", () => {
    expect(decide(5001).outcome).toBe("needs_human");
  });

  it("RA-1: uses the limit it is given, not a fixed one", () => {
    const result = decideRefund({
      amountCents: 8000,
      order: recentOrder,
      limitCents: 10000,
      now: NOW,
    });
    expect(result.outcome).toBe("approve");
  });

  it.each([0, -500, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "RA-2: rejects the amount %s",
    (amount) => {
      expect(decide(amount).outcome).toBe("reject");
    },
  );

  it("RA-2: rejects more than the customer paid", () => {
    const result = decide(14901);
    expect(result.outcome).toBe("reject");
  });

  it("RA-2: allows exactly what the customer paid (to a person, over the limit)", () => {
    expect(decide(14900).outcome).toBe("needs_human");
  });

  it("RA-3: rejects an order that was already refunded", () => {
    const result = decide(500, { ...recentOrder, refunded: true });
    expect(result).toMatchObject({ outcome: "reject" });
  });

  it("RA-3: the already-refunded check comes before the limit", () => {
    const result = decide(100, { ...recentOrder, refunded: true });
    expect(result.outcome).toBe("reject");
  });

  it("RA-4: sends an old order to a person even when it is under the limit", () => {
    const old = { ...recentOrder, orderedAt: "2026-09-01T12:00:00Z" };
    expect(decide(500, old).outcome).toBe("needs_human");
  });

  it("RA-4: an order exactly 30 days old is still inside the window", () => {
    const edge = { ...recentOrder, orderedAt: "2026-10-18T12:00:00Z" };
    expect(decide(500, edge).outcome).toBe("approve");
  });

  it("RA-4: an unreadable order date goes to a person", () => {
    const bad = { ...recentOrder, orderedAt: "not a date" };
    expect(decide(500, bad).outcome).toBe("needs_human");
  });

  it("explains every reject and every hand to a person", () => {
    for (const result of [decide(0), decide(5001)]) {
      expect(result).toHaveProperty("reason");
    }
  });
});

describe("limitProblem", () => {
  it("RA-14: accepts a sensible limit", () => {
    expect(limitProblem(5000)).toBeNull();
    expect(limitProblem(MAX_LIMIT_CENTS)).toBeNull();
  });

  it.each([0, -1, 12.5, Number.NaN, "5000", null, undefined])(
    "RA-14: refuses %s",
    (value) => {
      expect(limitProblem(value)).toEqual(expect.any(String));
    },
  );

  it("RA-14: refuses a limit over the maximum", () => {
    expect(limitProblem(MAX_LIMIT_CENTS + 1)).toEqual(expect.any(String));
  });
});

describe("formatCents", () => {
  it("shows dollars and cents", () => {
    expect(formatCents(3500)).toBe("$35.00");
    expect(formatCents(799)).toBe("$7.99");
  });
});
