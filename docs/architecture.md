# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |
| Module checks | `specs/module-N/`, `scripts/check.mjs` | Each module's spec, instructions, rubric and acceptance tests; `npm run check` runs them |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`, except where a module has
   moved it to a database: Module 2 part 2 moves stock to a Supabase
   `inventory` table, read through `lib/copper/inventory.ts`. Facts that don't
   change daily (prices, colors) stay in the files.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Module 2: Ask Copper tools

**Summary:** the four tools the shopping chatbot can call, so prices, totals
and stock come from code and data instead of the model's memory.

| Piece | Where | What it does |
|---|---|---|
| Tools | `lib/copper/assistant/tools.ts` | `get_products`, `get_prices`, `calculate_cost`, `check_availability`, exported as `copperTools` |
| Data | `lib/copper/catalog.ts`, `lib/copper/inventory.ts` | Prices and colors from the catalog; stock read fresh from the Supabase `inventory` table by `readInventory()`, which returns `null` (so Copper says it can't check) when Supabase isn't set up or can't be read |

**Data flow:** model picks a tool and writes its input → zod schema validates
it → ordinary TypeScript reads the catalog or stock list → result goes back to
the model.

**Decisions and trade-offs:** input schemas are strict (unknown fields,
6 years or 1.5 years are rejected) so the app, not the model, protects the
business. Each line is rounded to cents before summing. Stock is never cached.
`not_a_color` is decided before stock is read, so it holds when stock is down.

**Risks and open questions:** the tools only read, so they can't change
anything. A blank `color` is treated as "every color".

### Ask Copper: the action and the panel

| Piece | Where | What it does |
|---|---|---|
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper({ messages, useTools })` validates the request, returns `{ progress }` at once and reads the model stream in the background |
| Panel | `components/copper/ask-copper.tsx` | Floating launcher and Sheet; two separate chats (tools on / off); starter questions; shows `<SetupRequired />` without a key |
| Stations | `components/copper/ask-copper-stations.tsx` | Draws one answer: tools on offer, thinking, tool calls, "what's happening now" |
| Tool card | `components/copper/ask-copper-tool-card.tsx` | One tool call, always open: what Copper sent, what came back |
| Page / header | `app/page.tsx`, `components/copper/site-header.tsx` | Mounts the panel (with `isAiConfigured()`) and links to `#ask` |
| AI calls | `lib/ai/call.ts` (module 2, feature `ask-copper`) | `callStream` with `THOUGHT_SUMMARIES`; tools on adds instructions, the four tools and `stepCountIs(5)` |

**Data flow:** shopper question → panel (that chat's finished turns plus the
question) → `askCopper` → `callStream` → model → tool calls run in
`tools.ts` → each stream part updates a `Progress` → fresh copies go out through
a live value → `readLive()` in the panel redraws.

**Decisions and trade-offs:** a live value (not an API route) keeps the site to
one page. Each update is a full copy, so a missed update loses nothing. The
request is checked with zod (shape and size) because a Server Action is a public
POST endpoint. With tools off the model gets no instructions at all, so the
comparison shows what it does when nothing tells it to check.

**Risks and open questions:** cost per question is logged to `ai_calls`. The
default model is set in `lib/ai/models.ts` and can be changed with `AI_MODEL`.

## Module 4: Refund agent

**Summary:** a second agent that handles refund requests. Plain code decides
whether a refund is small enough to approve automatically; larger ones wait for
a person in the Refund Console. The AI handles the conversation, and code and
people handle the money. The full spec is
[`docs/refund-agent/spec.md`](refund-agent/spec.md).

| Piece | Where | What it does |
|---|---|---|
| Panels | `components/copper/refund-panels.tsx`, mounted in `app/page.tsx` | A "Copper Support" launcher and two slide-out panels (support chat and Refund Console), also opened by `/#support` and `/#refund-console`. The site stays one page |
| Support chat | `components/copper/support-chat.tsx` | A chat with two agents. Shows who has the chat, a "Request a refund" button and each tool call. The panel shows `<SetupRequired />` without an AI key |
| Switchboard | `lib/copper/assistant/support.ts` | `askSupport({ messages, mode })`: runs the agent that owns the mode, and changes the mode when an agent hands off or hands back |
| Copper's hand-off | `lib/copper/assistant/handoff.ts` | `hand_off_to_refund_agent`, the support instructions, and a keyword safety net |
| Refund agent | `lib/copper/assistant/refund-agent.ts` | Its instructions and four tools: `lookup_order`, `request_refund`, `check_refund_status`, `hand_back_to_copper` |
| The rule | `lib/copper/refund-policy.ts` | `decideRefund`: approve, send to a person, or reject. Plain code, no AI |
| Saving and deciding | `lib/copper/refund-service.ts`, `lib/copper/refunds.ts` | `requestRefund` and `decideAsHuman`; the only file that reads or writes the refund tables |
| Refund Console | `components/copper/refund-console.tsx`, `lib/copper/refund-actions.ts` | Pending queue (reject needs a reason), auto-refund limit editor, refund log. Data is loaded by a Server Action each time the panel opens |
| Data | `supabase/migrations/20261117000000_refunds.sql`, `supabase/seed.sql` | Tables `orders`, `refunds`, `settings`, with demo orders |
| AI calls | `lib/ai/call.ts` (module 4, features `ask-copper-support` and `refund-agent`) | `callStream` with thought summaries; up to 5 steps per agent |

**Data flow:** customer message → support chat (sends the chat's `mode`) →
`askSupport` → the agent for that mode → tool call → `refund-service` → rules in
`refund-policy.ts` → `refunds` table → result back to the model → reply. Over the
limit, the row is saved as `pending`; a person's click in the Refund Console
changes it, and the agent reports it the next time `check_refund_status` runs.

**Decisions and trade-offs:**
- **The rule is code.** `request_refund` takes no limit input; the limit is read
  from the `settings` table, so no model can choose its own.
- **A separate support chat.** Module 2's tests fix Ask Copper's panel and tools,
  so the two-agent chat is a new panel and action and Ask Copper is untouched.
- **Panels, not pages.** Module 1's AC-1.4 requires a single page, so the chat
  and the console are slide-out panels on `/`.
- **The chat holds the mode.** No `chats` table: the page already holds the
  conversation, and a changed mode can't approve money anyway.
- **The agents never talk to each other.** The code changes the mode; the agent
  and the human meet only in the database.
- **Money in whole cents** to avoid rounding mistakes.

**Risks and open questions:** the app has no login, so the console and the
refund tables are open to anyone with the public key: a class demo only, and the
console says so. The customer learns a human's decision only on their next
message (no live push). Cost per message is logged to `ai_calls`.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```
