// Refund agent: the second agent's instructions and its four tools. A tool is a
// small piece of code the model can choose to run. The model writes the input;
// ordinary code does the work and hands back the result. None of these tools
// take the auto-refund limit as input, so the model can't choose its own.
import { tool } from "ai";
import { z } from "zod";
import {
  readLatestRefundForOrder,
  readOrder,
  readRefund,
} from "@/lib/copper/refunds";
import { requestRefund, type RefundRequestResult } from "@/lib/copper/refund-service";
import { formatCents } from "@/lib/copper/refund-policy";

export const REFUND_INSTRUCTIONS = `You are Copper's refund assistant for Copper State Labs. You are an AI assistant. A customer has been passed to you because they want a refund. Be polite, calm and brief. Use plain words. Larger or unusual requests are reviewed by a person called a refund specialist; you are not that person, and you never decide anything yourself.

Rules:
1. Only help with refunds. If the customer asks about anything else (prices, stock, products), call hand_back_to_copper and write nothing else, so Copper can answer straight away.
2. Get the order number first, then call lookup_order to check the order. If you don't have the order number, ask for it. If the amount or the reason isn't clear, ask for just that. Don't ask for more than you need.
3. As soon as you have the order number, the amount and the customer's reason, call request_refund. Always call it, even if the order looks old, large or unusual: the app decides, not you. Never decide yourself whether a refund is allowed. If the customer says "the full amount", use the full amount paid that lookup_order shows. Use the customer's own words as the reason.
4. Never say a refund is approved, rejected, passed on or being reviewed unless a tool result in this conversation shows it. If you haven't called request_refund yet, you have not submitted anything, so don't say you have. If request_refund says the request is pending, tell the customer warmly, in your own words, that it has been passed to a refund specialist who will review it as soon as possible, and that they can come back to this chat to ask how it is going. Don't promise a specific time or an outcome.
5. If a customer asks what happened with an earlier refund request, call lookup_order and read latestRefund. If it is pending, say a refund specialist is still reviewing it and will get to it as soon as possible. If it is approved, say so. If it was rejected, tell them the reason exactly as the tool gives it. Don't make a new request for an order that already has a pending one. You can also use check_refund_status when you have a refund id.
6. Never invent order details, amounts or refund ids. If a tool says it can't check right now, or a tool call fails, say that plainly and suggest trying again soon. Never say a request was sent if the tool call failed.
7. Never mention or guess any refund limit or dollar threshold. If asked, say a refund specialist reviews some requests.
8. When the refund is settled (approved, rejected or waiting for review), tell the customer the outcome, ask if there is anything else, and call hand_back_to_copper so Copper takes over the chat.`;

const orderId = z.string().regex(/^\d{1,10}$/, "An order number is digits only.");

export const lookupOrderInput = z.object({ orderId }).strict();

export const requestRefundInput = z
  .object({
    orderId,
    amountUsd: z
      .number()
      .positive()
      .max(10000)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
        message: "Use dollars and cents, like 35.00.",
      }),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export const checkRefundStatusInput = z
  .object({ refundId: z.uuid() })
  .strict();

export type LookupOrderResult =
  | {
      status: "ok";
      order: {
        id: string;
        items: string;
        paidUsd: string;
        orderedAt: string;
        alreadyRefunded: boolean;
        /** The latest refund request on this order, or null if there has never been one. */
        latestRefund: {
          refundId: string;
          refundStatus: "approved" | "pending" | "rejected";
          amountUsd: string;
          decidedBy: "auto" | "rules" | "human" | null;
          reviewerNote: string | null;
        } | null;
      };
    }
  | { status: "not_found"; message: string }
  | { status: "unavailable"; message: string };

/** lookup_order: what was bought, what was paid and whether it was already refunded. */
export async function lookupOrder(
  input: z.infer<typeof lookupOrderInput>,
): Promise<LookupOrderResult> {
  const order = await readOrder(input.orderId);
  if (order === null) {
    return {
      status: "unavailable",
      message: "Orders can't be checked right now. Please try again soon.",
    };
  }
  if (order === "not_found") {
    return { status: "not_found", message: "There is no order with that number." };
  }
  // The latest refund on the order, so a customer asking "what happened to my
  // refund?" gets the real answer (status and a reviewer's reason) and not a
  // second request.
  const refund = await readLatestRefundForOrder(order.id);
  if (refund === null) {
    return {
      status: "unavailable",
      message: "Orders can't be checked right now. Please try again soon.",
    };
  }
  return {
    status: "ok",
    order: {
      id: order.id,
      items: order.items,
      paidUsd: formatCents(order.amount_cents),
      orderedAt: order.ordered_at,
      alreadyRefunded: order.refunded,
      latestRefund:
        refund === "none"
          ? null
          : {
              refundId: refund.id,
              refundStatus: refund.status,
              amountUsd: formatCents(refund.amount_cents),
              decidedBy: refund.decided_by,
              reviewerNote: refund.reviewer_note,
            },
    },
  };
}

/** request_refund: asks the rules for a decision and saves it. */
export async function requestRefundTool(
  input: z.infer<typeof requestRefundInput>,
): Promise<RefundRequestResult> {
  return requestRefund({
    orderId: input.orderId,
    amountCents: Math.round(input.amountUsd * 100),
    reason: input.reason,
  });
}

export type RefundStatusResult =
  | {
      status: "ok";
      refundStatus: "approved" | "pending" | "rejected";
      amountUsd: string;
      decidedBy: "auto" | "rules" | "human" | null;
      reviewerNote: string | null;
    }
  | { status: "not_found"; message: string }
  | { status: "unavailable"; message: string };

/** check_refund_status: where a refund stands now, and the reviewer's reason if there is one. */
export async function checkRefundStatus(
  input: z.infer<typeof checkRefundStatusInput>,
): Promise<RefundStatusResult> {
  const refund = await readRefund(input.refundId);
  if (refund === null) {
    return {
      status: "unavailable",
      message: "Refunds can't be checked right now. Please try again soon.",
    };
  }
  if (refund === "not_found") {
    return { status: "not_found", message: "There is no refund with that id." };
  }
  return {
    status: "ok",
    refundStatus: refund.status,
    amountUsd: formatCents(refund.amount_cents),
    decidedBy: refund.decided_by,
    reviewerNote: refund.reviewer_note,
  };
}

const lookup_order = tool({
  description:
    "Look up one order by its number: what was bought, what was paid, the date, whether it was already refunded, and the latest refund request on it (its status and any reviewer's reason).",
  inputSchema: lookupOrderInput,
  execute: async (input) => lookupOrder(input),
});

const request_refund = tool({
  description:
    "Ask for a refund on an order, with the amount in dollars and the customer's reason. The app decides and saves the result: approved, pending a person's review, or rejected.",
  inputSchema: requestRefundInput,
  execute: async (input) => requestRefundTool(input),
});

const check_refund_status = tool({
  description:
    "Check where a refund request stands (approved, pending or rejected) using its refund id, including the reviewer's reason for a rejection.",
  inputSchema: checkRefundStatusInput,
  execute: async (input) => checkRefundStatus(input),
});

const hand_back_to_copper = tool({
  description:
    "Give the chat back to Copper, the shopping assistant, when the refund is settled or the customer asks about something else.",
  inputSchema: z.object({}).strict(),
  execute: async () => ({ handedBack: true as const }),
});

export const refundTools = {
  lookup_order,
  request_refund,
  check_refund_status,
  hand_back_to_copper,
};
