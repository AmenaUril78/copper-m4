// Refund agent: how Ask Copper passes a refund request to the Refund agent.
// This is a separate file, and a separate set of tools, so Ask Copper's own
// four tools (copperTools) and instructions stay exactly as Module 2 defines
// them.
import { tool } from "ai";
import { z } from "zod";
import { copperTools } from "@/lib/copper/assistant/tools";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";

/** Copper's instructions for the support chat: the Module 2 rules plus the refund hand-off. */
export const SUPPORT_INSTRUCTIONS = `${COPPER_INSTRUCTIONS}

Refunds (this overrides rule 5 for refunds only):
6. If the customer asks for a refund, a return, or their money back, in any words, call hand_off_to_refund_agent straight away. Then say in one short sentence that the refund assistant is taking over.
7. Never discuss refund amounts, outcomes or timing yourself, never promise a refund, and never ask for order numbers or reasons: the refund assistant does that. Never say a refund request was submitted, passed on or approved: only the refund assistant can do that, after the app confirms it.
8. Never mention or guess any refund limit or dollar threshold.`;

const hand_off_to_refund_agent = tool({
  description:
    "Pass the chat to the refund assistant when the customer wants a refund, a return or their money back.",
  inputSchema: z.object({}).strict(),
  execute: async () => ({ handedOff: true as const }),
});

/** The four shopping tools plus the hand-off. Used only by the support chat. */
export const supportTools = { ...copperTools, hand_off_to_refund_agent };

/** Words that clearly mean "refund". Used as a safety net if the model doesn't hand off. */
const REFUND_WORDS =
  /\b(refunds?|refunded|money back|get my money|chargeback|reimburse\w*)\b/i;

export function looksLikeRefundRequest(message: string): boolean {
  return REFUND_WORDS.test(message);
}
