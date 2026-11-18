"use client";

// Copper Support: a chat with two agents. Copper (shopping) is the front door;
// when a customer wants a refund the chat passes to the Refund agent, and back
// again when the refund is settled. The panel keeps the chat's "mode" (which
// agent has it) and sends it with every message. Each answer is drawn step by
// step: the thinking, each tool call, and the hand-offs.
import { ArrowUpIcon, ReceiptTextIcon } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ToolCard } from "@/components/copper/ask-copper-tool-card";
import { RefundToolCard } from "@/components/copper/refund-tool-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readLive } from "@/lib/ai/live";
import {
  TOOL_LABELS,
  type Step,
} from "@/lib/copper/assistant/progress";
import {
  askSupport,
  type SupportMessage,
  type SupportMode,
  type SupportProgress,
} from "@/lib/copper/assistant/support";
import { cn } from "@/lib/utils";

export const SUPPORT_STARTERS = [
  "Is Copper Notes in Night Sky in stock?",
  "I'd like a refund for order 1001",
  "I want my money back for order 1003",
];

const REFUND_REQUEST_TEXT = "I'd like to request a refund.";

export type SupportTurn = { question: string; progress: SupportProgress | null };
type Turn = SupportTurn;

const FAILED: SupportProgress = {
  steps: [],
  reply: "Sorry, I couldn't answer that just now. Please try again.",
  status: "error",
  mode: "shopping",
};

/** Only finished answers go back to the model. */
function historyOf(turns: Turn[]): SupportMessage[] {
  return turns.flatMap(({ question, progress }) =>
    progress?.status === "done"
      ? [
          { role: "user" as const, content: question },
          { role: "assistant" as const, content: progress.reply },
        ]
      : [],
  );
}

function modeOf(turns: Turn[]): SupportMode {
  const last = turns.at(-1)?.progress;
  return last?.status === "done" ? last.mode : "shopping";
}

const AGENT_NAME: Record<SupportMode, string> = {
  shopping: "Copper (shopping)",
  refund: "Refund assistant",
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground border-y py-1 text-center text-xs font-medium">
      {children}
    </p>
  );
}

function StepView({ step, number }: { step: Step; number: number }) {
  if (step.type === "thinking") {
    return (
      <p
        data-testid="thinking"
        className="text-muted-foreground border-l-2 pl-3 text-sm italic"
      >
        {step.text}
      </p>
    );
  }
  if (step.name === "hand_off_to_refund_agent") {
    return <Notice>Chat passed to the refund assistant</Notice>;
  }
  if (step.name === "hand_back_to_copper") {
    return <Notice>Chat passed back to Copper</Notice>;
  }
  return step.name in TOOL_LABELS ? (
    <ToolCard step={step} number={number} />
  ) : (
    <RefundToolCard step={step} number={number} />
  );
}

/**
 * Numbers the tool cards in an answer. The two hand-off notices aren't tools
 * the shopper needs to count, so they don't take a number.
 */
const isNotice = (step: Step) =>
  step.type === "tool" &&
  (step.name === "hand_off_to_refund_agent" ||
    step.name === "hand_back_to_copper");

export function SupportChat({
  className,
  turns: sharedTurns,
  setTurns: setSharedTurns,
}: {
  className?: string;
  /**
   * The conversation, kept by whoever mounts the chat. A slide-out panel
   * unmounts its content when it closes, so the panel keeps the turns and the
   * chat picks up where it left off. Without these, the chat keeps its own.
   */
  turns?: Turn[];
  setTurns?: Dispatch<SetStateAction<Turn[]>>;
}) {
  const [ownTurns, setOwnTurns] = useState<Turn[]>([]);
  const turns = sharedTurns ?? ownTurns;
  const setTurns = setSharedTurns ?? setOwnTurns;
  const [draft, setDraft] = useState("");
  const body = useRef<HTMLDivElement>(null);

  const mode = modeOf(turns);
  const last = turns.at(-1);
  const streaming =
    last !== undefined && (!last.progress || last.progress.status === "working");

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function send(text: string, forceMode?: SupportMode) {
    const question = text.trim();
    if (!question || streaming) return;
    const index = turns.length;
    const messages = [
      ...historyOf(turns),
      { role: "user" as const, content: question },
    ];
    const setProgress = (progress: SupportProgress | null) =>
      setTurns((all) =>
        all.map((turn, i) => (i === index ? { ...turn, progress } : turn)),
      );

    setDraft("");
    setTurns((all) => [...all, { question, progress: null }]);
    try {
      const { progress } = await askSupport({
        messages,
        mode: forceMode ?? mode,
      });
      for await (const update of readLive(progress)) setProgress(update);
    } catch {
      setProgress(FAILED);
    }
  }

  return (
    <section
      data-testid="support-chat"
      aria-label="Copper Support chat"
      className={cn("bg-card flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      <header className="bg-chart-5 text-secondary flex flex-wrap items-center justify-between gap-2 p-3">
        <div>
          <p className="text-sm font-semibold">Copper Support</p>
          <p className="text-secondary/70 text-xs">
            Two agents share this chat. Code decides who answers.
          </p>
        </div>
        <Badge
          data-testid="support-mode"
          variant={mode === "refund" ? "default" : "secondary"}
        >
          Now chatting with: {AGENT_NAME[mode]}
        </Badge>
      </header>

      <div ref={body} className="bg-secondary flex-1 space-y-5 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Ask about Copper, or ask for a refund. Try an order number from 1001
            to 1009.
          </p>
        )}
        {turns.map((turn, i) => {
          const steps = turn.progress?.steps ?? [];
          return (
            <div key={i} className="space-y-3">
              <p className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
                {turn.question}
              </p>
              {steps.map((step, s) => (
                <StepView
                  key={step.type === "tool" ? step.id : `thinking-${s}`}
                  step={step}
                  number={steps.slice(0, s + 1).filter((x) => x.type === "tool" && !isNotice(x)).length}
                />
              ))}
              {(!turn.progress || turn.progress.status === "working") &&
                !turn.progress?.reply && (
                  <p className="text-muted-foreground text-sm italic">
                    Working on it…
                  </p>
                )}
              {turn.progress?.reply && (
                <div className="bg-card rounded-2xl rounded-tl-sm border p-3 text-sm shadow-xs">
                  <p className="text-primary mb-1 text-xs font-semibold">
                    Copper Support
                  </p>
                  <p className="whitespace-pre-wrap">{turn.progress.reply}</p>
                </div>
              )}
            </div>
          );
        })}
        {!streaming && turns.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            {SUPPORT_STARTERS.map((starter) => (
              <Button
                key={starter}
                variant="outline"
                size="sm"
                className="bg-card h-auto rounded-xl py-1.5 text-left whitespace-normal"
                onClick={() => send(starter)}
              >
                {starter}
              </Button>
            ))}
          </div>
        )}
      </div>

      <form
        className="bg-card flex items-center gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        {mode === "shopping" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={streaming}
            onClick={() => send(REFUND_REQUEST_TEXT, "refund")}
            className="shrink-0 rounded-full"
          >
            <ReceiptTextIcon />
            Request a refund
          </Button>
        )}
        <input
          aria-label="Your message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            mode === "refund" ? "Reply to the refund assistant…" : "Ask Copper…"
          }
          className="border-input focus-visible:ring-ring/50 min-w-0 flex-1 rounded-full border px-4 py-2 text-sm outline-none focus-visible:ring-3"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={streaming || !draft.trim()}
          className="rounded-full"
        >
          <ArrowUpIcon />
        </Button>
      </form>
    </section>
  );
}
