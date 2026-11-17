// Refund agent: checks that what the customer is told matches what the app
// really did. A model can write "your request was passed to a specialist"
// without ever calling request_refund, and then nothing was saved and nobody
// will ever see it. These plain functions let the switchboard catch that.
import type { Step } from "@/lib/copper/assistant/progress";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

/** One tool result that proves something real exists in the refund tables. */
function isEvidence(name: string, output: unknown): boolean {
  const out = asRecord(output);
  if (name === "request_refund") {
    return ["approved", "pending", "rejected"].includes(String(out.status));
  }
  if (name === "check_refund_status") return out.status === "ok";
  if (name === "lookup_order") {
    return out.status === "ok" && asRecord(out.order).latestRefund != null;
  }
  return false;
}

/**
 * True if, in this answer, a tool really returned a refund outcome: a request
 * the app decided or saved, or an order that already has a refund on it.
 * A failed or missing tool call is not evidence.
 */
export function hasRefundEvidence(steps: Step[]): boolean {
  return steps.some(
    (step) =>
      step.type === "tool" &&
      step.state === "done" &&
      isEvidence(step.name, step.output),
  );
}

// Phrases that say a request was sent on, or that a refund was decided.
const CLAIMS: RegExp[] = [
  /\bspecialist\b/i,
  /\b(has|have|had) been (passed|sent|forwarded|submitted|escalated|approved|rejected|declined|processed)\b/i,
  /\b(is|was|are) (now )?(pending|approved|rejected|declined)\b/i,
  /\b(i've|i have|i'll|i will|we've|we have) (submitted|passed|sent|forwarded|escalated|approved|processed|filed)\b/i,
  /\bwill (review|look at|be reviewed)\b/i,
  /\b(under|in) review\b/i,
];

/** True if the reply says a refund request was sent on or decided. */
export function claimsRefundOutcome(reply: string): boolean {
  return CLAIMS.some((pattern) => pattern.test(reply));
}

/**
 * A reply that claims an outcome with nothing to back it up. This is the one
 * thing the customer must never be told.
 */
export function isUnbackedClaim(reply: string, steps: Step[]): boolean {
  return claimsRefundOutcome(reply) && !hasRefundEvidence(steps);
}

/** What the agent is told when it was caught claiming an outcome that doesn't exist. */
export const CORRECTION = `Correction: in your last reply you told the customer a refund request was sent on or decided, but no refund request was saved, because request_refund was never successfully called. Do not repeat that claim. If the customer has given an order number, call lookup_order and then request_refund now (use the amount they asked for, or the full amount paid if they said "the full amount"; use their words as the reason). If you are missing the order number, the amount or the reason, ask for just what is missing. Only describe an outcome after a tool result shows it.`;

/** What the customer sees if the agent still can't back up its claim after one retry. */
export const UNBACKED_FALLBACK =
  "I haven't submitted a refund request for you yet. Please tell me your order number, how much you'd like refunded, and why, and I'll submit it.";

/**
 * If the agent's last request_refund returned an outcome the reply never
 * mentions, this is the line to add, so the customer always hears what the
 * app actually did. Returns null when the reply already covers it.
 */
export function receiptFor(steps: Step[], reply: string): string | null {
  const last = steps
    .filter(
      (step) =>
        step.type === "tool" &&
        step.name === "request_refund" &&
        step.state === "done",
    )
    .at(-1);
  if (!last || last.type !== "tool") return null;

  const out = asRecord(last.output);
  const message = typeof out.message === "string" ? out.message : null;
  if (!message) return null;

  switch (out.status) {
    case "pending":
      return /\bspecialist\b/i.test(reply) ? null : message;
    case "approved":
      return /\bapproved\b/i.test(reply) ? null : message;
    case "rejected":
      return /\b(rejected|declined|can't|cannot|unable|not (be )?(approved|refunded)|already)\b/i.test(
        reply,
      )
        ? null
        : message;
    case "unavailable":
      return /\b(can't|cannot|unable|try again)\b/i.test(reply) ? null : message;
    default:
      return null;
  }
}
