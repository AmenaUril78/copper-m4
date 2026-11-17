// Refund agent: the rule that decides whether a refund is approved, rejected or
// sent to a person. It is ordinary code, not the AI, so a customer (or a model)
// can't talk their way past it. Money is always whole cents, never decimals.

/** Refunds up to this amount are approved automatically, until an admin changes it. */
export const DEFAULT_LIMIT_CENTS = 5000;
/** The highest limit an admin may set. */
export const MAX_LIMIT_CENTS = 100000;
/** Orders older than this many days always go to a person. */
export const RETURN_WINDOW_DAYS = 30;

/** What the rule needs to know about an order. */
export type RefundOrder = {
  amountCents: number;
  orderedAt: string;
  refunded: boolean;
};

export type RefundDecision =
  | { outcome: "approve" }
  | { outcome: "needs_human"; reason: string }
  | { outcome: "reject"; reason: string };

export type DecideRefundInput = {
  amountCents: number;
  order: RefundOrder;
  limitCents: number;
  /** Today's date. Only tests pass this. */
  now?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The checks run in this order, and the first one that fires wins:
 * 1. a bad amount is rejected,
 * 2. an order already refunded is rejected,
 * 3. more than the customer paid is rejected,
 * 4. an order past the return window goes to a person,
 * 5. at or under the limit is approved,
 * 6. anything else goes to a person.
 */
export function decideRefund(input: DecideRefundInput): RefundDecision {
  const { amountCents, order, limitCents } = input;
  const now = input.now ?? new Date();

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return {
      outcome: "reject",
      reason: "The refund amount must be more than zero.",
    };
  }
  if (order.refunded) {
    return {
      outcome: "reject",
      reason: "This order has already been refunded.",
    };
  }
  if (amountCents > order.amountCents) {
    return {
      outcome: "reject",
      reason: "The refund can't be more than the customer paid.",
    };
  }

  const ordered = new Date(order.orderedAt).getTime();
  if (
    Number.isNaN(ordered) ||
    (now.getTime() - ordered) / DAY_MS > RETURN_WINDOW_DAYS
  ) {
    return {
      outcome: "needs_human",
      reason: `This order is outside the ${RETURN_WINDOW_DAYS}-day return window.`,
    };
  }

  if (amountCents <= limitCents) return { outcome: "approve" };
  return {
    outcome: "needs_human",
    reason: "The amount is over the automatic refund limit.",
  };
}

/** Checks a new auto-refund limit from the console. Returns an error message, or null if it's fine. */
export function limitProblem(limitCents: unknown): string | null {
  if (
    typeof limitCents !== "number" ||
    !Number.isInteger(limitCents) ||
    limitCents <= 0
  ) {
    return "The limit must be more than zero.";
  }
  if (limitCents > MAX_LIMIT_CENTS) {
    return `The limit can't be more than $${MAX_LIMIT_CENTS / 100}.`;
  }
  return null;
}

/** 3500 becomes "$35.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
