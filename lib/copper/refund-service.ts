// Refund agent: the two things that can change a refund's outcome.
//   requestRefund: a customer asks (through the Refund agent's tool). The
//     rules in refund-policy.ts decide, and the result is saved.
//   decideAsHuman: a person approves or rejects a pending refund in the console.
// Neither takes the auto-refund limit as input: it is always read from the
// database, so no caller (and no model) can choose its own limit.
import {
  createRefund,
  decidePendingRefund,
  markOrderRefunded,
  readLimitCents,
  readOpenRefundForOrder,
  readOrder,
  type RefundRow,
} from "@/lib/copper/refunds";
import { decideRefund, formatCents } from "@/lib/copper/refund-policy";

export type RefundRequestResult =
  | { status: "approved"; refundId: string; message: string }
  | { status: "pending"; refundId: string; message: string }
  | { status: "rejected"; refundId?: string; message: string }
  | { status: "not_found"; message: string }
  | { status: "unavailable"; message: string };

const UNAVAILABLE =
  "Refunds can't be checked right now. Please try again soon.";

export type RequestRefundInput = {
  orderId: string;
  amountCents: number;
  reason: string;
};

/** A customer's refund request: decide with the rules, save it, say what happened. */
export async function requestRefund(
  input: RequestRefundInput,
): Promise<RefundRequestResult> {
  const order = await readOrder(input.orderId);
  if (order === null) return { status: "unavailable", message: UNAVAILABLE };
  if (order === "not_found") {
    return { status: "not_found", message: "There is no order with that number." };
  }

  const limitCents = await readLimitCents();
  if (limitCents === null) return { status: "unavailable", message: UNAVAILABLE };

  // One open request per order, so a customer can't stack requests.
  const open = await readOpenRefundForOrder(order.id);
  if (open === null) return { status: "unavailable", message: UNAVAILABLE };
  if (open !== "none") {
    return {
      status: "pending",
      refundId: open.id,
      message:
        "A refund request for this order is already with a refund specialist. They will review it as soon as possible.",
    };
  }

  const decision = decideRefund({
    amountCents: input.amountCents,
    order: {
      amountCents: order.amount_cents,
      orderedAt: order.ordered_at,
      refunded: order.refunded,
    },
    limitCents,
  });

  if (decision.outcome === "reject") {
    // A nonsense amount (zero, negative, not whole cents) has nothing worth
    // logging, so only a real amount is saved as a rejected request.
    const loggable =
      Number.isInteger(input.amountCents) && input.amountCents > 0;
    const saved = loggable
      ? await createRefund({
          orderId: order.id,
          amountCents: input.amountCents,
          reason: input.reason,
          status: "rejected",
          decidedBy: "rules",
          reviewerNote: decision.reason,
        })
      : null;
    return { status: "rejected", refundId: saved?.id, message: decision.reason };
  }

  if (decision.outcome === "needs_human") {
    const saved = await createRefund({
      orderId: order.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: "pending",
      decidedBy: null,
      reviewerNote: null,
    });
    if (!saved) return { status: "unavailable", message: UNAVAILABLE };
    return {
      status: "pending",
      refundId: saved.id,
      message: `Your refund request for ${formatCents(input.amountCents)} has been passed to a refund specialist. They will review it as soon as possible.`,
    };
  }

  // Approved by the rules: record it, then mark the order refunded.
  const saved = await createRefund({
    orderId: order.id,
    amountCents: input.amountCents,
    reason: input.reason,
    status: "approved",
    decidedBy: "auto",
    reviewerNote: null,
  });
  if (!saved) return { status: "unavailable", message: UNAVAILABLE };
  await markOrderRefunded(order.id);
  return {
    status: "approved",
    refundId: saved.id,
    message: `Your refund of ${formatCents(input.amountCents)} is approved.`,
  };
}

export type HumanDecision =
  | { action: "approve"; note?: string }
  | { action: "reject"; reason: string };

export type HumanDecisionResult =
  | { ok: true; refund: RefundRow }
  | { ok: false; error: string };

/** A person's decision on a pending refund. Rejecting needs a written reason. */
export async function decideAsHuman(
  refundId: string,
  decision: HumanDecision,
): Promise<HumanDecisionResult> {
  const note =
    decision.action === "reject"
      ? decision.reason.trim()
      : (decision.note?.trim() ?? "");

  // Checked here as well as on the page, because the page can be bypassed.
  if (decision.action === "reject" && note === "") {
    return { ok: false, error: "Add a reason before rejecting a refund." };
  }

  const saved = await decidePendingRefund(refundId, {
    status: decision.action === "approve" ? "approved" : "rejected",
    note: note === "" ? null : note,
  });
  if (saved === null) return { ok: false, error: UNAVAILABLE };
  if (saved === "not_pending") {
    return {
      ok: false,
      error: "This refund was already decided, so it can't be changed.",
    };
  }
  if (decision.action === "approve") await markOrderRefunded(saved.order_id);
  return { ok: true, refund: saved };
}
