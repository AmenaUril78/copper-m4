"use server";

// Refund agent: the "switchboard" for the Copper Support chat. Each message
// goes to one of two agents, depending on the chat's mode:
//   shopping: Copper, with its four shopping tools plus a hand-off tool
//   refund:   the Refund agent, with its own instructions and tools
// The agents never talk to each other. When one hands off (or hands back), the
// mode changes and the other agent answers. This is a separate action from
// askCopper (the Ask Copper panel), which stays exactly as Module 2 built it.
import { stepCountIs } from "ai";
import { z } from "zod";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import {
  looksLikeRefundRequest,
  SUPPORT_INSTRUCTIONS,
  supportTools,
} from "@/lib/copper/assistant/handoff";
import type { Progress, Step } from "@/lib/copper/assistant/progress";
import {
  CORRECTION,
  isUnbackedClaim,
  receiptFor,
  UNBACKED_FALLBACK,
} from "@/lib/copper/assistant/reply-check";
import {
  REFUND_INSTRUCTIONS,
  refundTools,
} from "@/lib/copper/assistant/refund-agent";

export type SupportMode = "shopping" | "refund";
export type SupportMessage = { role: "user" | "assistant"; content: string };
export type SupportRequest = { messages: SupportMessage[]; mode: SupportMode };

/** What the chat draws, plus which agent now has the chat. */
export type SupportProgress = Progress & { mode: SupportMode };
export type SupportResult = { progress: Live<SupportProgress> };

const MAX_STEPS = 5;
/**
 * At most three agent runs per message: a hand-off (or hand-back) and the
 * agent it hands to, plus one retry if the Refund agent claims an outcome
 * that no tool result backs up.
 */
const MAX_RUNS = 3;

// A Server Action is open to anyone who can send the POST, so the request is
// checked for shape and size before it reaches a model.
const requestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    mode: z.enum(["shopping", "refund"]),
  })
  .strict();

const APOLOGY = "Sorry, I couldn't answer that just now. Please try again.";

function snapshot(progress: SupportProgress): SupportProgress {
  return {
    ...progress,
    steps: progress.steps.map((step): Step => ({ ...step })),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Starts the agent that owns this mode. A correction is added to its instructions on a retry. */
function runAgent(
  mode: SupportMode,
  messages: SupportMessage[],
  correction?: string,
) {
  return callStream(
    {
      module: 4,
      feature: mode === "refund" ? "refund-agent" : "ask-copper-support",
    },
    {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      stopWhen: stepCountIs(MAX_STEPS),
      ...(mode === "refund"
        ? {
            instructions: correction
              ? `${REFUND_INSTRUCTIONS}\n\n${correction}`
              : REFUND_INSTRUCTIONS,
            tools: refundTools,
          }
        : { instructions: SUPPORT_INSTRUCTIONS, tools: supportTools }),
    },
  );
}

export async function askSupport(request: SupportRequest): Promise<SupportResult> {
  const { messages, mode: startMode } = requestSchema.parse(request);
  const { live, update, done } = createLive<SupportProgress>();

  void (async () => {
    const progress: SupportProgress = {
      steps: [],
      reply: "",
      status: "working",
      mode: startMode,
    };
    const toolStep = (id: string) =>
      progress.steps.find((s) => s.type === "tool" && s.id === id);
    const lastQuestion = messages.filter((m) => m.role === "user").at(-1);

    // Set once the Refund agent has been caught claiming an outcome nothing
    // backs up, so it is retried only once.
    let correction: string | undefined;

    try {
      for (let run = 0; run < MAX_RUNS; run++) {
        const agent = progress.mode;
        const result = runAgent(agent, messages, correction);
        let handedOff = false;
        let handedBack = false;
        let thisReply = "";
        // A second agent's words start a new paragraph.
        if (progress.reply.trim()) progress.reply += "\n\n";

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "reasoning-delta": {
              const last = progress.steps.at(-1);
              if (last?.type === "thinking") last.text += part.text;
              else progress.steps.push({ type: "thinking", text: part.text });
              break;
            }
            case "tool-input-start":
              progress.steps.push({
                type: "tool",
                id: part.id,
                name: part.toolName,
                state: "calling",
              });
              break;
            case "tool-call": {
              const step = toolStep(part.toolCallId);
              if (step?.type === "tool") step.input = part.input;
              else
                progress.steps.push({
                  type: "tool",
                  id: part.toolCallId,
                  name: part.toolName,
                  state: "calling",
                  input: part.input,
                });
              break;
            }
            case "tool-result": {
              const step = toolStep(part.toolCallId);
              if (step?.type === "tool") {
                step.output = part.output;
                step.state = "done";
              }
              if (part.toolName === "hand_off_to_refund_agent") handedOff = true;
              if (part.toolName === "hand_back_to_copper") handedBack = true;
              break;
            }
            case "tool-error": {
              const step = toolStep(part.toolCallId);
              if (step?.type === "tool") {
                step.output = messageOf(part.error);
                step.state = "error";
              }
              break;
            }
            case "text-delta":
              progress.reply += part.text;
              thisReply += part.text;
              break;
            case "error":
              throw part.error;
            default:
              continue;
          }
          update(snapshot(progress));
        }

        // The customer must never be told a request was sent on or decided
        // unless a tool result shows it really was. If the Refund agent says so
        // with nothing saved, its words are removed and it tries again; if it
        // still can't back it up, the customer is told plainly nothing was sent.
        if (agent === "refund" && isUnbackedClaim(thisReply, progress.steps)) {
          progress.reply = progress.reply.slice(
            0,
            progress.reply.length - thisReply.length,
          );
          if (correction === undefined && run + 1 < MAX_RUNS) {
            correction = CORRECTION;
            update(snapshot(progress));
            continue;
          }
          progress.reply += UNBACKED_FALLBACK;
          thisReply = UNBACKED_FALLBACK;
          update(snapshot(progress));
        }

        // Who answers next? Only the code decides, from what the agent did.
        if (agent === "shopping") {
          const safetyNet =
            !handedOff &&
            lastQuestion !== undefined &&
            looksLikeRefundRequest(lastQuestion.content);
          if (!handedOff && !safetyNet) break;
          progress.mode = "refund";
        } else {
          if (!handedBack) break;
          progress.mode = "shopping";
          // A hand-back with nothing said means "this isn't mine": Copper
          // answers the same question now. After a goodbye, the chat just waits.
          if (thisReply.trim()) break;
        }
        update(snapshot(progress));
      }

      // If a request was saved, the customer always hears what the app did,
      // even if the agent left it out of its own words.
      const receipt = receiptFor(progress.steps, progress.reply);
      if (receipt) progress.reply = `${progress.reply.trim()}\n\n${receipt}`;

      if (!progress.reply.trim()) progress.reply = APOLOGY;
      done(snapshot({ ...progress, status: "done" }));
    } catch (error) {
      console.error("[support]", messageOf(error));
      done(
        snapshot({
          ...progress,
          reply: progress.reply.trim() || APOLOGY,
          status: "error",
        }),
      );
    }
  })();

  return { progress: live };
}
