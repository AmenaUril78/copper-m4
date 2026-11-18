# Refund Agent Spec: two agents, one human, one rule in code

_Fictional — for educational use. Status: built, updated to match the build. The database tables still need to be created in Supabase (see "Before you can try it")._

**Changes made while building** (so this spec matches the code):

1. **A separate Copper Support panel.** Module 2's tests require Ask Copper's panel to send exactly `{ messages, useTools }` and to have exactly four tools, and they can't be changed. So the two-agent chat is its own panel (`askSupport` and `components/copper/support-chat.tsx`), and the Ask Copper panel is untouched.
2. **Panels, not pages.** Module 1's AC-1.4 says the site is a single page with no other routes, so both the support chat and the Refund Console are slide-out panels on the home page (`components/copper/refund-panels.tsx`), opened from a "Copper Support" button or from `/#support` and `/#refund-console`. The console loads its data with a Server Action each time it opens. On a wide screen (1024px and up) the Support panel shows the chat and the Refund Console side by side, so a customer's request and the staff decision are visible together; on narrower screens the console is a separate panel opened from a link.
3. **No `chats` table.** The chat page already holds the whole conversation, so it also holds the mode (`shopping` or `refund`) and sends it with each message.
4. **The chat keeps its conversation.** A closed panel unmounts its content, so the conversation is kept in `RefundPanels` and survives closing the panel or visiting the console.
5. **No claim without proof.** The first live test showed the Refund agent telling a customer their order 1005 request was "passed to a specialist" without ever calling `request_refund`, so nothing was saved. `lib/copper/assistant/reply-check.ts` now checks every Refund agent reply against the tool results (see section 4).
6. **Two names.** The AI is the **refund assistant**. Only a person is a **refund specialist**, so "passed to a refund specialist" always means a real request is waiting in the console.
7. **`request_refund` takes dollars, and the amount is optional** (`amountUsd`, like 35.00). Left out, the code refunds the full amount paid, read from the order. A customer asking for a refund means the whole order unless they say otherwise, so the agent never asks how much to refund. A named amount is converted to whole cents before the rules see it.

## Scenario

Customers sometimes want their money back. Today Ask Copper can answer questions about products, prices and stock, but it cannot help with a refund. The Copper Crew (the support team) does all of it by hand.

We add a second agent, the **Refund agent**. Ask Copper recognizes a refund request and hands the chat over. The Refund agent looks up the order and asks for the refund. Then **ordinary code, not the AI, decides**:

- At or under the **auto-refund limit** (starts at $50.00), the refund is approved automatically.
- Over the limit, the request waits as **pending** until a **person** approves or rejects it in a staff page called the **Refund Console**.

The AI handles the conversation. Code and people handle the money.

## User stories

- As a **customer**, I want to **ask for a refund in the chat**, so that **I get an answer without waiting for a human when the amount is small**.
- As a **customer**, I want to **be told why a refund was rejected**, so that **I'm not left guessing**.
- As a **supervisor**, I want to **review large refunds and approve or reject them**, so that **a person is responsible for big amounts**.
- As an **admin**, I want to **change the auto-refund limit**, so that **management can adjust it without a code change**.

## How it fits together

```
Copper Support chat ──► Switchboard (Server Action) ──► Copper agent  ◄─ hand off / hand back ─►  Refund agent
   (holds the mode)            │ runs the agent for the mode                                          │ its tools
                               ▼                                                                      ▼
                       (mode comes back with the reply)                                    Refund rules (plain code)
                                                                                                      │
Refund Console (staff) ◄──────────────────────── Supabase: orders, refunds, settings ◄────────────────┘
```

- The two agents **never message each other**. The chat page sends a `mode` (`shopping` or `refund`) with each message, and the switchboard runs the agent that owns it.
- The Refund agent and the human meet only in the **database**.
- A picture of this design: https://claude.ai/artifact/82giW4KEF621JDZqGoAZPZ

## What you have to work with

| Where | What |
|---|---|
| `lib/ai/call.ts` | `callText`, `callObject`, `callStream`, `isAiConfigured()`. Every model call goes through these and is logged to `ai_calls` |
| `lib/copper/assistant/ask.ts` | `askCopper()`: the Ask Copper action. **Not changed** (Module 2's tests depend on it) |
| `lib/copper/assistant/tools.ts` | Ask Copper's four existing tools. **Not changed** |
| `lib/copper/assistant/instructions.ts` | Ask Copper's instructions. **Not changed**; the support chat adds to them in `handoff.ts` |
| `lib/copper/assistant/progress.ts` | `Progress` type and `TOOL_LABELS`. Gets a separate `REFUND_TOOL_LABELS` |
| `lib/copper/inventory.ts` | Example of reading Supabase and returning `null` when it can't be read |
| `components/copper/ask-copper.tsx` | The Ask Copper panel. **Not changed** |
| `components/setup-required.tsx` | `<SetupRequired />`, shown instead of a page whose service isn't configured |
| `components/ui/` | shadcn components (card, table, button, input, textarea, badge) |

## Key ideas

| Idea | In this feature |
|---|---|
| **Hand-off** | A tool call that switches which agent answers the chat. The conversation history goes with it |
| **Mode** | A saved value on the chat (`shopping` or `refund`). Code reads it to route each message |
| **The rule is code** | `decideRefund` compares the amount with the limit. The model can't see or change the limit, so it can't be talked past it |
| **Human in the loop** | Over the limit, the agent pauses. A person clicks Approve or Reject, and the agent reports the result |
| **Proof before words** | The customer is only told a request was sent on or decided if a tool result shows it was. Otherwise the reply is removed and the agent retries once |
| **Audit trail** | Every refund records whether code or a human decided, when, and the reason or note |

## What to build

### 1. Data (Supabase)

Money is stored in **cents** (whole numbers), never decimals, to avoid rounding errors.

| Table | Columns | Purpose |
|---|---|---|
| `orders` | `id`, `customer_name`, `items` (text), `amount_cents`, `ordered_at`, `refunded` (yes/no) | Fictional demo orders the agent looks up. Seed with a few, including one under $50 and one over |
| `refunds` | `id`, `order_id`, `amount_cents`, `reason` (customer's), `status` (`approved`, `pending`, `rejected`), `decided_by` (`auto`, `human`, `rules`), `reviewer_note`, `created_at`, `decided_at` | One row per request. The shared state between agent and human |
| `settings` | `key`, `value` | Holds `auto_refund_limit_cents` (default 5000) |

The SQL is in `supabase/migrations/20261117000000_refunds.sql`, and the demo orders are in `supabase/seed.sql`.

`decided_by = rules` means the code rejected it (invalid or already refunded). `auto` means the code approved it. `human` means a person decided.

If Supabase isn't set up or can't be read, the data functions return `null` and pages show `<SetupRequired />` or a plain message. Nothing crashes.

### 2. Refund rules (plain code): `lib/copper/refund-policy.ts`

`decideRefund({ amountCents, order, limitCents })` returns one of: `approve`, `needs_human`, `reject` (with a reason). In this order:

1. Amount is not a whole number of cents above zero → `reject`.
2. Order already refunded → `reject` ("already refunded").
3. Amount is more than the order's amount paid → `reject`.
4. Order is older than the return window (30 days) → `needs_human`.
5. Amount is **at or under** the limit → `approve`.
6. Otherwise → `needs_human`.

Exactly $50.00 is approved. $50.01 needs a human.

### 3. The Refund agent: `lib/copper/assistant/refund-agent.ts`

Its own instructions, in plain English:

- Be polite and short. Only help with refunds.
- Never say a refund is approved until a tool says so.
- Never invent order details or amounts.
- Never ask the customer how much they want refunded. Ask only for the order number, and for the reason if they haven't given one. The full amount paid is the default; the agent names an amount only if the customer says they want less.
- Never mention or guess the auto-refund limit.
- If the customer asks about something else, call `hand_back_to_copper`.

Its tools (strict zod schemas; unknown fields are rejected):

| Tool | Input | Does |
|---|---|---|
| `lookup_order` | `orderId` | Returns items, amount paid, date, whether already refunded, and the **latest refund on the order** (its status and any reviewer's reason) |
| `request_refund` | `orderId`, `reason`, optional `amountUsd` (like 35.00) | Reads the full amount paid from the order unless `amountUsd` is given, converts to cents, calls `decideRefund`, saves the `refunds` row, returns `approved`, `pending` or `rejected` with the reason. **Takes no limit input** |
| `check_refund_status` | `refundId` | Returns `status` and `reviewer_note` |
| `hand_back_to_copper` | none | Sets the chat mode back to `shopping` |

### 4. Switching agents: `lib/copper/assistant/support.ts` (the switchboard)

`askSupport({ messages, mode })` runs the agent that owns the mode: Copper (shopping tools plus the hand-off tool) or the Refund agent. When an agent hands off or hands back, the **code** changes the mode and the other agent answers the same message (at most two agents per message). The new mode comes back with the reply, and the chat page sends it with the next message. There are **three ways into refund mode**, all ending in the same mode:

1. **Tool:** the `hand_off_to_refund_agent` tool (`lib/copper/assistant/handoff.ts`).
2. **Button:** a "Request a refund" button in the Copper Support panel, which sends the first message in refund mode.
3. **Safety net:** if a message clearly mentions a refund or money back and Copper did not hand off, the code switches the mode itself.

While the mode is `refund`, every message goes to the Refund agent until it hands back. A hand-back with nothing said ("this isn't mine") lets Copper answer the same message right away. A hand-back after a goodbye waits for the customer's next message.

**No claim without proof (`reply-check.ts`).** After each Refund agent reply, the code checks it against the tool results from the same answer. If the reply says a request was passed on, submitted, approved or rejected, or mentions a specialist reviewing, but no tool returned a saved outcome (`request_refund` approved, pending or rejected; `lookup_order` showing a refund already on the order; `check_refund_status` finding the refund), then:

1. the reply's words are removed, and the agent runs once more with a correction ("call request_refund now, or ask for the order number or reason if one is missing");
2. if it still can't back the claim up, the customer sees: "I haven't submitted a refund request for you yet. Please tell me your order number and why you'd like a refund, and I'll submit it."

After the agent finishes, if its last `request_refund` returned an outcome the reply never mentions, the app's own message is added, so the customer always hears what really happened. A failed tool call is never evidence.

### 5. New rules for Copper in the support chat (`handoff.ts`)

Ask Copper's own instructions are unchanged. The support chat sends them plus these:

- Refund, return or money-back request → call `hand_off_to_refund_agent` right away. Say in one sentence that a refund specialist is taking over.
- Never discuss refund outcomes, promise a refund, or mention the limit.
- Don't collect order numbers or reasons; that is the Refund agent's job.

The Ask Copper panel (and its tools-off comparison chat) gets none of this.

### 6. The Refund Console: `components/copper/refund-console.tsx`

A staff panel on the home page (opened from the support panel or `/#refund-console`) with three parts:

0. **Always current:** a Refresh button, and the list re-reads itself every 15 seconds while the panel is open. A failed refresh keeps the last list (and any note being typed) and says so.
1. **Pending queue:** each pending refund with order, customer, amount, the customer's reason, and time. **Approve** (optional note) and **Reject**. **Reject cannot be saved without a written reason**, checked in the UI and again on the server.
2. **Limit editor:** shows the current auto-refund limit and lets an admin change it.
3. **Refund log:** every refund with status, who decided (`auto`, `human` or `rules`), when, and the note or reason.

Approve and Reject only work on a refund that is still `pending`, so two clicks (or two staff) can't decide it twice.

**Demo only:** the app has no login, so anyone who opens the console could approve refunds. The console doesn't show a notice about this, so it is recorded here instead. Real use needs authentication.

### 7. Telling the customer

When a request goes to a person, `request_refund` returns this message, which also shows on the tool card: "Your refund request for $149.00 has been passed to a refund specialist. They will review it as soon as possible." The agent passes it on warmly in its own words, without promising a specific time or an outcome, and without mentioning the limit or why it went to a person.

After a human decides, the customer learns the outcome when they ask. The Refund agent calls `lookup_order` (which includes the order's latest refund) or `check_refund_status`, and states the result and, for a rejection, the reason. It never makes a second request for an order that already has a pending one. A live update is a stretch goal (see Open questions).

## Acceptance criteria

| ID | Criterion |
|---|---|
| **RA-1** | `decideRefund` approves an amount at the limit ($50.00) and sends $50.01 to a human |
| **RA-2** | `decideRefund` rejects zero, negative, non-whole-cent and above-amount-paid refunds |
| **RA-3** | `decideRefund` rejects an order that is already refunded |
| **RA-4** | An order past the return window goes to a human even when it is under the limit |
| **RA-5** | `request_refund` has no limit input and cannot approve an amount over the limit, whatever the model sends |
| **RA-6** | Every refund request saves a `refunds` row with the correct `status` and `decided_by` |
| **RA-7** | `hand_off_to_refund_agent`, the button and the safety net each set the chat mode to `refund` |
| **RA-8** | In `refund` mode every message goes to the Refund agent; `hand_back_to_copper` returns it to `shopping` |
| **RA-9** | The Refund agent has exactly the four tools above; Copper in the support chat has its four shopping tools plus only the hand-off; Ask Copper's own four tools are unchanged |
| **RA-10** | Neither agent states the limit when asked (check the instructions and a sample conversation) |
| **RA-11** | The console lists pending refunds, and Approve changes a pending refund to `approved` with `decided_by = human` |
| **RA-12** | Reject without a reason is refused by the UI and by the server; with a reason it saves `rejected` and the note |
| **RA-13** | A refund that is no longer pending cannot be approved or rejected again |
| **RA-14** | The admin can change the limit; invalid values (zero, negative, over the maximum of $1,000) are refused; the next refund uses the new limit |
| **RA-15** | The refund log shows status, who decided, time and the note or reason for every refund |
| **RA-16** | `check_refund_status` and `lookup_order` return the status and reviewer note, and the agent tells the customer the reason for a rejection |
| **RA-17** | Without Supabase or an AI key, the chat and the console show `<SetupRequired />` or a plain message and do not crash |
| **RA-18** | Every model call goes through `lib/ai/call.ts` and is logged with `module` 4 and `feature` `refund-agent` or `ask-copper-support` |
| **RA-19** | `npm test`, `npm run lint` and `npm run typecheck` pass, and `docs/architecture.md` has a Module 4 section |
| **RA-20** | When a request goes to a person, the customer is told it has been passed to a refund specialist who will review it as soon as possible, with no mention of the limit |
| **RA-21** | If the Refund agent tells a customer a request was sent on or decided and no tool result shows it, the reply is removed and the agent retries once; if it still can't back it up, the customer is told no request was submitted |
| **RA-22** | The Refund Console has a Refresh button and re-reads the refunds every 15 seconds while open; a failed refresh keeps the last list and any note being typed |
| **RA-23** | A customer who asks for a refund is never asked how much to refund. `request_refund` with no amount refunds the full amount paid, and a named amount (a partial refund) is used as given |

## Out of scope

Real money movement, login for the console, email or Slack alerts, partial refunds, per-customer monthly limits, and a dashboard. These are good future work.

## Open questions

1. **Limit default and maximum:** $50.00 and $1,000. Confirm with the instructor.
2. **Return window:** 30 days is assumed. Confirm or drop it.
3. **Live update to the chat:** start with the status check on the next message. Try a short refresh check only if it stays simple.
4. **Module 3 docs-search tool:** the class sample's Ask Copper has it. It isn't in this repo yet; leave it out unless Module 3 is merged first.

## Before you can try it

The code is built and tested with fake data, but the live Supabase project doesn't have the tables yet. To try it end to end:

1. Run `supabase/migrations/20261117000000_refunds.sql` and then `supabase/seed.sql` in your Supabase project (SQL editor, or ask Claude to apply it, which needs your approval because it changes the live database).
2. Make sure `.env.local` has the Supabase and Google AI variables, then run `npm run dev`.
3. Click **Copper Support** (bottom left) to chat, and use "Staff: open the Refund Console" in that panel, or open `/#refund-console`.

Try order 1001 ($7.99, auto-approved), 1003 ($149, waits for a person), 1005 (60 days old, goes to a person), and 1006 (already refunded, rejected).

Three more orders each test one rule:

By default a customer is refunded the **full amount paid**, so just saying "I'd like a refund for order 1007, I don't need it" requests the whole $79.00. To test the other amounts below, say the amount in your message, for example "I only want $50 back".

| Order | Paid | Say | What should happen |
|---|---|---|---|
| **1007** (Copper Plus, annual, 8 days old) | $79.00 | (no amount) | Waits for a person: the full $79.00 is over the limit |
| | | "only $50.00" | Approved automatically: exactly at the limit counts |
| | | "only $50.01" | Waits for a person: one cent over |
| | | "$100.00" | Rejected: more than was paid |
| **1008** (Copper Home + Copper Notes, 5 days old) | $278.00 | (no amount) | Waits for a person: the full $278.00 is over the limit |
| | | "only $30.00" | Approved automatically: a partial refund under the limit |
| | | "only $129.00" | Waits for a person: over the limit |
| | | "$300.00" | Rejected: more than was paid |
| **1009** (Copper Notes, 31 days old) | $129.00 | "only $20.00" | Waits for a person even though it is small: past the 30-day return window |

Each order can only be refunded once (an approved refund marks it refunded), and an order can only have one request waiting at a time. To try a different amount on the same order, reset the demo in the Supabase SQL editor. This clears all refund requests and un-refunds every order except 1006, which is meant to stay refunded:

```sql
delete from refunds;
update orders set refunded = false where id <> '1006';
```

**Demo-only security:** the policies in the migration let the public Supabase key read the refund tables and make only the changes the app needs. Anyone with that key could write to them directly and skip the rules. Real use needs authentication and a private server key.
