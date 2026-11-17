// One refund-chat tool call, drawn as a round trip (what the agent sent, what
// came back), like the Ask Copper tool card but for the refund tools. Values
// are shown as a labelled list, never raw JSON.
import { Loader2Icon } from "lucide-react";
import {
  REFUND_TOOL_LABELS,
  type ToolStep,
} from "@/lib/copper/assistant/progress";

const LABELS: Record<string, string> = {
  orderId: "Order",
  id: "Order",
  amountUsd: "Amount",
  paidUsd: "Paid",
  reason: "Reason",
  refundId: "Refund id",
  orderedAt: "Ordered",
  alreadyRefunded: "Already refunded",
  refundStatus: "Refund status",
  status: "Result",
  reviewerNote: "Reviewer's reason",
  decidedBy: "Decided by",
  items: "Items",
  message: "Message",
};

function labelOf(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function valueOf(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key.endsWith("Usd")) {
    return `$${value.toFixed(2)}`;
  }
  if (key === "orderedAt" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("en-US");
  }
  return String(value).replaceAll("_", " ");
}

/** One level of nesting is flattened, so `{ order: { items } }` reads as a list. */
function fieldsOf(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, inner]) =>
      typeof inner === "object" && inner !== null
        ? fieldsOf(inner)
        : [[key, valueOf(key, inner)] as [string, string]],
  );
}

function Fields({ value, empty }: { value: unknown; empty: string }) {
  const fields = fieldsOf(value);
  if (fields.length === 0) return <p className="italic">{empty}</p>;
  return (
    <dl className="space-y-1">
      {fields.map(([key, text]) => (
        <div key={key} className="flex gap-3">
          <dt className="text-muted-foreground w-28 shrink-0">
            {labelOf(key)}
          </dt>
          <dd className="min-w-0 font-medium break-words">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RefundToolCard({
  step,
  number,
}: {
  step: ToolStep;
  number: number;
}) {
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card overflow-hidden rounded-lg border text-sm"
    >
      <div className="bg-accent text-primary-foreground flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="bg-primary-foreground/20 rounded px-1.5 text-xs">
          tool {number}
        </span>
        <span className="ml-auto text-xs">
          {REFUND_TOOL_LABELS[step.name] ?? step.name}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          → What the agent sent
        </p>
        {step.input === undefined ? (
          <p className="text-muted-foreground flex items-center gap-2 italic">
            <Loader2Icon className="size-3.5 animate-spin" />
            filling in the details…
          </p>
        ) : (
          <Fields value={step.input} empty="Nothing, it just made the request" />
        )}
      </div>
      <div className="bg-accent/10 space-y-2 border-t p-3">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          ← What came back
        </p>
        {step.state === "error" ? (
          <p>{String(step.output ?? "Something went wrong.")}</p>
        ) : step.state === "calling" || step.output === undefined ? (
          <p className="text-muted-foreground flex items-center gap-2 italic">
            <Loader2Icon className="size-3.5 animate-spin" />
            the app is running the code…
          </p>
        ) : (
          <Fields value={step.output} empty="Done" />
        )}
      </div>
    </div>
  );
}
