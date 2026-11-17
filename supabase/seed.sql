-- Today's stock, from the Product Bible, Section 10. These are the same six
-- rows as lib/copper/data/inventory.json. Safe to run more than once.
insert into inventory (sku, product, color, units_in_stock, next_shipment) values
  ('CH-POL', 'Copper Home', 'Polished Copper', 240, '2026-11-20'),
  ('CH-TEA', 'Copper Home', 'Patina Teal', 6, '2026-11-06'),
  ('CH-NSK', 'Copper Home', 'Night Sky', 185, '2026-11-20'),
  ('CN-BRC', 'Copper Notes', 'Brushed Copper', 310, '2026-11-13'),
  ('CN-DSA', 'Copper Notes', 'Desert Sand', 92, '2026-11-13'),
  ('CN-NSK', 'Copper Notes', 'Night Sky', 0, '2026-11-14')
on conflict (sku) do nothing;

-- Refund agent demo orders (fictional customers). Dates are relative to today,
-- so the recent ones stay inside the 30-day return window. Safe to run more
-- than once.
insert into orders (id, customer_name, items, amount_cents, ordered_at, refunded) values
  ('1001', 'Maya Ortiz', 'Copper Plus, monthly', 799, now() - interval '4 days', false),
  ('1002', 'Devon Reyes', 'Copper Notes (Desert Sand)', 12900, now() - interval '9 days', false),
  ('1003', 'Priya Shah', 'Copper Home (Night Sky)', 14900, now() - interval '6 days', false),
  ('1004', 'Sam Whitaker', 'Copper Plus, monthly', 799, now() - interval '3 days', false),
  ('1005', 'Lena Park', 'Copper Notes (Night Sky)', 12900, now() - interval '60 days', false),
  ('1006', 'Omar Haddad', 'Copper Plus, monthly', 799, now() - interval '20 days', true),
  -- Test scenarios: the exact limit, a partial refund and asking for too much,
  -- and an order one day past the 30-day return window.
  ('1007', 'Nora Whitfield', 'Copper Plus, annual', 7900, now() - interval '8 days', false),
  ('1008', 'Jamal Brooks', 'Copper Home (Polished Copper) + Copper Notes (Brushed Copper)', 27800, now() - interval '5 days', false),
  ('1009', 'Elena Vasquez', 'Copper Notes (Brushed Copper)', 12900, now() - interval '31 days', false)
on conflict (id) do nothing;

insert into settings (key, value) values ('auto_refund_limit_cents', 5000)
on conflict (key) do nothing;
