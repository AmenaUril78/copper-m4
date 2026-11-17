-- Refund agent: demo orders, refund requests and the auto-refund limit.
-- Money is stored in whole cents (integers), never decimals, so there are no
-- rounding mistakes.
--
-- DEMO ONLY: the app has no login yet, so (like the rest of the app) these
-- tables are reached with the public publishable key. The policies below let
-- that key read everything and make only the changes the Refund agent and the
-- Refund Console need. Real use needs authentication and a private key.

-- Fictional orders the Refund agent can look up.
create table if not exists orders (
  id text primary key,
  customer_name text not null,
  items text not null,
  amount_cents integer not null check (amount_cents > 0),
  ordered_at timestamptz not null,
  refunded boolean not null default false
);

-- One row per refund request: the shared state between the agent and the human.
-- decided_by: 'auto' (code approved it), 'rules' (code rejected it) or 'human'
-- (a person decided). A pending request has no decided_by yet.
create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders (id),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null default '',
  status text not null check (status in ('approved', 'pending', 'rejected')),
  decided_by text check (decided_by in ('auto', 'rules', 'human')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  -- A person can't reject a refund without saying why.
  constraint human_rejection_needs_reason check (
    not (
      status = 'rejected'
      and decided_by = 'human'
      and coalesce(btrim(reviewer_note), '') = ''
    )
  )
);

create index if not exists refunds_status_idx on refunds (status);
create index if not exists refunds_order_idx on refunds (order_id);

-- Settings an admin can change, such as the auto-refund limit (in cents).
create table if not exists settings (
  key text primary key,
  value integer not null check (value > 0)
);

alter table orders enable row level security;
alter table refunds enable row level security;
alter table settings enable row level security;

drop policy if exists "orders are readable" on orders;
create policy "orders are readable" on orders for select using (true);
-- The only change allowed to an order: mark it refunded.
drop policy if exists "orders can be marked refunded" on orders;
create policy "orders can be marked refunded" on orders
  for update using (refunded = false) with check (refunded = true);

drop policy if exists "refunds are readable" on refunds;
create policy "refunds are readable" on refunds for select using (true);
drop policy if exists "refunds can be requested" on refunds;
create policy "refunds can be requested" on refunds
  for insert with check (status in ('approved', 'pending', 'rejected'));
-- A refund can only be decided while it is still pending, and only once.
drop policy if exists "pending refunds can be decided" on refunds;
create policy "pending refunds can be decided" on refunds
  for update using (status = 'pending')
  with check (status in ('approved', 'rejected') and decided_by = 'human');

drop policy if exists "settings are readable" on settings;
create policy "settings are readable" on settings for select using (true);
drop policy if exists "settings can be changed" on settings;
create policy "settings can be changed" on settings
  for update using (true) with check (value > 0 and value <= 100000);
drop policy if exists "settings can be added" on settings;
create policy "settings can be added" on settings
  for insert with check (value > 0 and value <= 100000);
