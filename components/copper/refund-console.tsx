"use client";

// The Refund Console: where a person decides refunds the code sent to them,
// changes the auto-refund limit, and reads the log. DEMO ONLY: no login yet.
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  approveRefund,
  changeLimit,
  rejectRefund,
  type ActionResult,
} from "@/lib/copper/refund-actions";
import { formatCents } from "@/lib/copper/refund-policy";
import type { RefundWithOrder } from "@/lib/copper/refunds";

const DECIDED_BY: Record<string, string> = {
  auto: "Auto (code approved)",
  rules: "Rules (code rejected)",
  human: "A person",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US") : "—";

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "approved"
          ? "default"
          : status === "pending"
            ? "secondary"
            : "destructive"
      }
    >
      {status}
    </Badge>
  );
}

function PendingCard({
  refund,
  onChanged,
}: {
  refund: RefundWithOrder;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    start(async () => {
      const result = await action();
      setError(result.ok ? null : result.error);
      if (result.ok) onChanged();
    });

  return (
    <Card data-testid="pending-refund" data-refund-id={refund.id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            Order {refund.order_id} · {formatCents(refund.amount_cents)}
          </span>
          <StatusBadge status="pending" />
        </CardTitle>
        <CardDescription>
          {refund.orders?.customer_name ?? "Unknown customer"} ·{" "}
          {refund.orders?.items ?? "Unknown items"} · asked {when(refund.created_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Customer&apos;s reason: </span>
          {refund.reason || "None given"}
        </p>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Note to the customer (needed to reject, optional to approve)
          </span>
          <Textarea
            aria-label={`Note for order ${refund.order_id}`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: this order is outside the 30-day return window."
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => run(() => approveRefund({ id: refund.id, note }))}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            disabled={busy || note.trim() === ""}
            onClick={() => run(() => rejectRefund({ id: refund.id, reason: note }))}
          >
            Reject
          </Button>
          {note.trim() === "" && (
            <span className="text-muted-foreground self-center text-xs">
              Write a reason to enable Reject.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LimitEditor({
  limitCents,
  onChanged,
}: {
  limitCents: number;
  onChanged: () => void;
}) {
  const [dollars, setDollars] = useState((limitCents / 100).toFixed(2));
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Auto-refund limit</CardTitle>
        <CardDescription>
          Refunds up to {formatCents(limitCents)} are approved automatically.
          Anything above it waits here for a person.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const cents = Math.round(Number(dollars) * 100);
            start(async () => {
              const result = await changeLimit({ limitCents: cents });
              setFailed(!result.ok);
              setMessage(result.ok ? "Limit saved." : result.error);
              if (result.ok) onChanged();
            });
          }}
        >
          <label className="space-y-1 text-sm">
            <span className="font-medium">New limit (USD)</span>
            <input
              aria-label="New limit in dollars"
              inputMode="decimal"
              value={dollars}
              onChange={(event) => setDollars(event.target.value)}
              className="border-input block w-32 rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <Button type="submit" disabled={busy}>
            Save limit
          </Button>
          {message && (
            <p
              role={failed ? "alert" : "status"}
              className={failed ? "text-destructive text-sm" : "text-sm"}
            >
              {message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function RefundConsole({
  refunds,
  limitCents,
  onChanged = () => {},
}: {
  refunds: RefundWithOrder[];
  limitCents: number;
  /** Called after a decision or a new limit is saved, so the panel can reload. */
  onChanged?: () => void;
}) {
  const pending = refunds.filter((r) => r.status === "pending");
  return (
    <div className="space-y-8">
      <section aria-labelledby="pending-heading" className="space-y-3">
        <h2 id="pending-heading" className="font-display text-xl font-bold">
          Waiting for a decision ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is waiting. Refunds over the limit will show up here.
          </p>
        ) : (
          pending.map((refund) => (
            <PendingCard key={refund.id} refund={refund} onChanged={onChanged} />
          ))
        )}
      </section>

      <LimitEditor
        key={limitCents}
        limitCents={limitCents}
        onChanged={onChanged}
      />

      <section aria-labelledby="log-heading" className="space-y-3">
        <h2 id="log-heading" className="font-display text-xl font-bold">
          Refund log
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided by</TableHead>
                <TableHead>Note or reason</TableHead>
                <TableHead>Asked</TableHead>
                <TableHead>Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No refunds yet.
                  </TableCell>
                </TableRow>
              )}
              {refunds.map((refund) => (
                <TableRow key={refund.id} data-testid="log-row">
                  <TableCell>{refund.order_id}</TableCell>
                  <TableCell>{formatCents(refund.amount_cents)}</TableCell>
                  <TableCell>
                    <StatusBadge status={refund.status} />
                  </TableCell>
                  <TableCell>
                    {refund.decided_by ? DECIDED_BY[refund.decided_by] : "—"}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    {refund.reviewer_note ?? "—"}
                  </TableCell>
                  <TableCell>{when(refund.created_at)}</TableCell>
                  <TableCell>{when(refund.decided_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
