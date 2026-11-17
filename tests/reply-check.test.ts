import { describe, expect, it } from "vitest";
import type { Step } from "@/lib/copper/assistant/progress";
import {
  claimsRefundOutcome,
  hasRefundEvidence,
  isUnbackedClaim,
  receiptFor,
} from "@/lib/copper/assistant/reply-check";

const tool = (name: string, output: unknown, state: "done" | "error" | "calling" = "done"): Step => ({
  type: "tool",
  id: `${name}-1`,
  name,
  state,
  input: {},
  output,
});

describe("hasRefundEvidence", () => {
  it("is true when request_refund returned an outcome", () => {
    for (const status of ["approved", "pending", "rejected"]) {
      expect(hasRefundEvidence([tool("request_refund", { status, message: "x" })])).toBe(true);
    }
  });

  it("is false with no tools, or only a hand-off", () => {
    expect(hasRefundEvidence([])).toBe(false);
    expect(hasRefundEvidence([tool("hand_off_to_refund_agent", { handedOff: true })])).toBe(false);
  });

  it("is false when request_refund failed, never ran, or couldn't reach the database", () => {
    expect(hasRefundEvidence([tool("request_refund", "Invalid input", "error")])).toBe(false);
    expect(hasRefundEvidence([tool("request_refund", undefined, "calling")])).toBe(false);
    expect(hasRefundEvidence([tool("request_refund", { status: "unavailable", message: "x" })])).toBe(false);
    expect(hasRefundEvidence([tool("request_refund", { status: "not_found", message: "x" })])).toBe(false);
  });

  it("lookup_order only counts when the order already has a refund on it", () => {
    expect(hasRefundEvidence([tool("lookup_order", { status: "ok", order: { latestRefund: null } })])).toBe(false);
    expect(
      hasRefundEvidence([
        tool("lookup_order", { status: "ok", order: { latestRefund: { refundStatus: "pending" } } }),
      ]),
    ).toBe(true);
  });

  it("check_refund_status counts when it found the refund", () => {
    expect(hasRefundEvidence([tool("check_refund_status", { status: "ok", refundStatus: "rejected" })])).toBe(true);
    expect(hasRefundEvidence([tool("check_refund_status", { status: "not_found" })])).toBe(false);
  });
});

describe("claimsRefundOutcome", () => {
  it.each([
    "I've passed your request to a refund specialist for review.",
    "Your request has been passed to the team.",
    "Your refund is approved.",
    "Your refund was rejected.",
    "A refund specialist will review it as soon as possible.",
    "It's under review.",
    "I have submitted your refund request.",
    "Your request is pending.",
  ])("catches: %s", (text) => {
    expect(claimsRefundOutcome(text)).toBe(true);
  });

  it.each([
    "What is your order number?",
    "Which order is it, and how much would you like refunded?",
    "Hi! I'm Copper's refund assistant. How can I help?",
    "Order 1005 was placed for $129.00. How much would you like back, and why?",
    "Sorry, I couldn't check that right now. Please try again soon.",
    "",
  ])("lets through: %s", (text) => {
    expect(claimsRefundOutcome(text)).toBe(false);
  });
});

describe("isUnbackedClaim", () => {
  it("flags a claim with nothing saved (the order 1005 bug)", () => {
    const steps = [tool("lookup_order", { status: "ok", order: { latestRefund: null } })];
    expect(isUnbackedClaim("Your request was passed to a refund specialist.", steps)).toBe(true);
  });

  it("lets a claim through when a tool backs it up", () => {
    const steps = [tool("request_refund", { status: "pending", message: "x" })];
    expect(isUnbackedClaim("It has been passed to a refund specialist.", steps)).toBe(false);
  });

  it("never flags a plain question", () => {
    expect(isUnbackedClaim("What is the order number?", [])).toBe(false);
  });
});

describe("receiptFor", () => {
  const pending = tool("request_refund", {
    status: "pending",
    message: "Your refund request for $129.00 has been passed to a refund specialist. They will review it as soon as possible.",
  });

  it("adds the app's message when the reply leaves out a pending request", () => {
    expect(receiptFor([pending], "Okay, all done!")).toMatch(/passed to a refund specialist/);
  });

  it("adds nothing when the reply already says so", () => {
    expect(receiptFor([pending], "A refund specialist will take a look.")).toBeNull();
  });

  it("covers approved, rejected and unavailable results too", () => {
    const approved = tool("request_refund", { status: "approved", message: "Your refund of $7.99 is approved." });
    expect(receiptFor([approved], "Thanks!")).toBe("Your refund of $7.99 is approved.");
    expect(receiptFor([approved], "Great, it's approved.")).toBeNull();

    const rejected = tool("request_refund", { status: "rejected", message: "This order has already been refunded." });
    expect(receiptFor([rejected], "Thanks!")).toBe("This order has already been refunded.");
    expect(receiptFor([rejected], "I'm sorry, that order was already refunded.")).toBeNull();

    const down = tool("request_refund", { status: "unavailable", message: "Refunds can't be checked right now." });
    expect(receiptFor([down], "Okay!")).toBe("Refunds can't be checked right now.");
  });

  it("uses the latest request, and adds nothing when none was made", () => {
    const approved = tool("request_refund", { status: "approved", message: "Approved." });
    expect(receiptFor([approved, pending], "Done.")).toMatch(/refund specialist/);
    expect(receiptFor([], "Done.")).toBeNull();
    expect(receiptFor([tool("request_refund", "bad input", "error")], "Done.")).toBeNull();
  });
});
