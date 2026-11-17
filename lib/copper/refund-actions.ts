"use server";

// Refund agent: what the Refund Console's panel does. A Server Action is a
// public POST endpoint, so every input is checked here, whatever the panel
// allowed. DEMO ONLY: the app has no login yet, so these actions are open to
// anyone who can reach them. Real use needs authentication first.
import { z } from "zod";
import { decideAsHuman } from "@/lib/copper/refund-service";
import { limitProblem } from "@/lib/copper/refund-policy";
import {
  listRefunds,
  readLimitCents,
  saveLimitCents,
  type RefundWithOrder,
} from "@/lib/copper/refunds";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** What the console panel shows, or `unavailable` when Supabase can't be read. */
export type ConsoleData =
  | { status: "ok"; refunds: RefundWithOrder[]; limitCents: number }
  | { status: "unavailable" };

const BAD_REQUEST: ActionResult = {
  ok: false,
  error: "That request wasn't valid. Reload the page and try again.",
};

const approveInput = z
  .object({ id: z.uuid(), note: z.string().max(500).optional() })
  .strict();
const rejectInput = z
  .object({ id: z.uuid(), reason: z.string().max(500) })
  .strict();
const limitInput = z.object({ limitCents: z.number() }).strict();

/** Every refund and the current limit, read fresh each time the panel opens. */
export async function loadRefundConsole(): Promise<ConsoleData> {
  const [refunds, limitCents] = await Promise.all([
    listRefunds(),
    readLimitCents(),
  ]);
  if (refunds === null || limitCents === null) return { status: "unavailable" };
  return { status: "ok", refunds, limitCents };
}

export async function approveRefund(input: {
  id: string;
  note?: string;
}): Promise<ActionResult> {
  const parsed = approveInput.safeParse(input);
  if (!parsed.success) return BAD_REQUEST;
  const result = await decideAsHuman(parsed.data.id, {
    action: "approve",
    note: parsed.data.note,
  });
  return result.ok ? { ok: true } : result;
}

export async function rejectRefund(input: {
  id: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = rejectInput.safeParse(input);
  if (!parsed.success) return BAD_REQUEST;
  const result = await decideAsHuman(parsed.data.id, {
    action: "reject",
    reason: parsed.data.reason,
  });
  return result.ok ? { ok: true } : result;
}

export async function changeLimit(input: {
  limitCents: number;
}): Promise<ActionResult> {
  const parsed = limitInput.safeParse(input);
  if (!parsed.success) return BAD_REQUEST;
  const problem = limitProblem(parsed.data.limitCents);
  if (problem) return { ok: false, error: problem };
  const saved = await saveLimitCents(parsed.data.limitCents);
  if (!saved) {
    return { ok: false, error: "The limit couldn't be saved. Please try again." };
  }
  return { ok: true };
}
