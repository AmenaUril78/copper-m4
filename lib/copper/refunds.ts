// Refund agent: reads and writes the orders, refunds and settings tables in
// Supabase. Every function returns `null` when Supabase isn't set up or can't
// be reached, so callers can say "I can't check that right now" and never
// crash or guess. This is the only file that talks to those tables.
import { DEFAULT_LIMIT_CENTS } from "@/lib/copper/refund-policy";
import { createStatelessClient } from "@/lib/supabase/server";

export type OrderRow = {
  id: string;
  customer_name: string;
  items: string;
  amount_cents: number;
  ordered_at: string;
  refunded: boolean;
};

export type RefundStatus = "approved" | "pending" | "rejected";
export type DecidedBy = "auto" | "rules" | "human";

export type RefundRow = {
  id: string;
  order_id: string;
  amount_cents: number;
  reason: string;
  status: RefundStatus;
  decided_by: DecidedBy | null;
  reviewer_note: string | null;
  created_at: string;
  decided_at: string | null;
};

/** A refund plus the order it belongs to, for the console. */
export type RefundWithOrder = RefundRow & {
  orders: { customer_name: string; items: string } | null;
};

const LIMIT_KEY = "auto_refund_limit_cents";

/** One order, `"not_found"` if there isn't one, or `null` if it can't be read. */
export async function readOrder(id: string): Promise<OrderRow | "not_found" | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id, customer_name, items, amount_cents, ordered_at, refunded")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return data ? (data as OrderRow) : "not_found";
  } catch {
    return null;
  }
}

/** Marks an order refunded. True only for the one call that actually changed it. */
export async function markOrderRefunded(id: string): Promise<boolean> {
  const supabase = createStatelessClient();
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ refunded: true })
      .eq("id", id)
      .eq("refunded", false)
      .select("id");
    return !error && (data?.length ?? 0) === 1;
  } catch {
    return false;
  }
}

export type NewRefund = {
  orderId: string;
  amountCents: number;
  reason: string;
  status: RefundStatus;
  decidedBy: DecidedBy | null;
  reviewerNote: string | null;
};

/** Saves a new refund request. Returns the saved row, or `null` if it couldn't be saved. */
export async function createRefund(input: NewRefund): Promise<RefundRow | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .insert({
        order_id: input.orderId,
        amount_cents: input.amountCents,
        reason: input.reason,
        status: input.status,
        decided_by: input.decidedBy,
        reviewer_note: input.reviewerNote,
        decided_at: input.status === "pending" ? null : new Date().toISOString(),
      })
      .select()
      .single();
    return error || !data ? null : (data as RefundRow);
  } catch {
    return null;
  }
}

/** One refund, `"not_found"` if there isn't one, or `null` if it can't be read. */
export async function readRefund(id: string): Promise<RefundRow | "not_found" | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return data ? (data as RefundRow) : "not_found";
  } catch {
    return null;
  }
}

/** The still-pending refund for an order, if there is one. `null` means it can't be read. */
export async function readOpenRefundForOrder(
  orderId: string,
): Promise<RefundRow | "none" | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .select()
      .eq("order_id", orderId)
      .eq("status", "pending")
      .limit(1);
    if (error || !data) return null;
    return data.length > 0 ? (data[0] as RefundRow) : "none";
  } catch {
    return null;
  }
}

/** The most recent refund for an order, `"none"` if there isn't one, or `null` if it can't be read. */
export async function readLatestRefundForOrder(
  orderId: string,
): Promise<RefundRow | "none" | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .select()
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data) return null;
    return data.length > 0 ? (data[0] as RefundRow) : "none";
  } catch {
    return null;
  }
}

/** Every refund, newest first, with its order. `null` means it can't be read. */
export async function listRefunds(): Promise<RefundWithOrder[] | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .select("*, orders(customer_name, items)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return null;
    return data as unknown as RefundWithOrder[];
  } catch {
    return null;
  }
}

/**
 * A person's decision on a refund. It only works while the refund is still
 * pending, so a second click (or a second person) can't decide it again:
 * that returns `"not_pending"`. `null` means the change couldn't be saved.
 */
export async function decidePendingRefund(
  id: string,
  decision: { status: "approved" | "rejected"; note: string | null },
): Promise<RefundRow | "not_pending" | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("refunds")
      .update({
        status: decision.status,
        decided_by: "human",
        reviewer_note: decision.note,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select();
    if (error || !data) return null;
    return data.length === 1 ? (data[0] as RefundRow) : "not_pending";
  } catch {
    return null;
  }
}

/** The auto-refund limit in cents. `null` means it can't be read. */
export async function readLimitCents(): Promise<number | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", LIMIT_KEY)
      .maybeSingle();
    if (error) return null;
    return data ? (data.value as number) : DEFAULT_LIMIT_CENTS;
  } catch {
    return null;
  }
}

/** Saves a new auto-refund limit. True if it was saved. */
export async function saveLimitCents(limitCents: number): Promise<boolean> {
  const supabase = createStatelessClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: LIMIT_KEY, value: limitCents });
    return !error;
  } catch {
    return false;
  }
}
