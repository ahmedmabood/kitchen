/*
# Fix demo seed: remove closed_at, correct unit math, add order codes

1. Problem
- `seed_demo_kitchen()` (live version) inserted a `closed_at` column that does
  not exist on `batches`, so "Reset demo data" failed for everyone.
- The demo data it produced violated the unit invariant on two past batches
  (more units ordered than capacity allowed).

2. Changes
- Rewrites `seed_demo_kitchen()`:
  - Drops the `closed_at` column from batch inserts.
  - Brownie & Tart Friday: 12 units, orders total exactly 12.
  - Sourdough Saturday: 10 units, orders total exactly 10.
  - Weekend Treat Box unchanged (20 capacity, 11 ordered, 9 available).
  - Friday Drop: brownies stay at 0 available; Diego's order now buys
    2 Sourdough Loaves; open-batch items sum to 20 available so
    available (20) + ordered (4) = capacity (24).
  - Generates 10-character order codes for every seeded order (same charset
    and length as the real checkout flow).

3. Security
- Function stays SECURITY DEFINER with `SET search_path = public`.
- Execute stays revoked from PUBLIC/anon, granted to authenticated only.
*/

CREATE OR REPLACE FUNCTION public.seed_demo_kitchen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid uuid;
  v_batch_id uuid;
  v_past_id uuid;
  v_order_id uuid;
  v_rec record;
  v_code text;
  v_i integer;
  v_p_cupcakes uuid; v_p_tarts uuid; v_p_rolls uuid; v_p_brownies uuid; v_p_sourdough uuid;
  v_friday date;
  v_t timestamptz;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'demo@maplecrumb.batchly';
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'DEMO_USER_MISSING';
  END IF;

  INSERT INTO products (seller_id, name, description, price, image_url, active)
  VALUES (v_uid, 'Chocolate Cupcakes (2)', 'Deep dark chocolate with a swirl of mascarpone frosting.', 8.00, null, true);
  SELECT id INTO v_p_cupcakes FROM products WHERE seller_id = v_uid AND name = 'Chocolate Cupcakes (2)';

  INSERT INTO products (seller_id, name, description, price, image_url, active)
  VALUES (v_uid, 'Lemon Tarts (2)', 'Buttery shell, sharp lemon curd, torched meringue peaks.', 9.50, null, true);
  SELECT id INTO v_p_tarts FROM products WHERE seller_id = v_uid AND name = 'Lemon Tarts (2)';

  INSERT INTO products (seller_id, name, description, price, image_url, active)
  VALUES (v_uid, 'Cinnamon Rolls (4)', 'Overnight-proofed brioche rolls with brown-butter glaze.', 12.00, null, true);
  SELECT id INTO v_p_rolls FROM products WHERE seller_id = v_uid AND name = 'Cinnamon Rolls (4)';

  INSERT INTO products (seller_id, name, description, price, image_url, active)
  VALUES (v_uid, 'Brownie Box (6)', 'Fudgy middles, crackly tops, flaky sea salt.', 15.00, null, true);
  SELECT id INTO v_p_brownies FROM products WHERE seller_id = v_uid AND name = 'Brownie Box (6)';

  INSERT INTO products (seller_id, name, description, price, image_url, active)
  VALUES (v_uid, 'Sourdough Loaf', '48-hour fermentation, deep caramel crust.', 10.00, null, true);
  SELECT id INTO v_p_sourdough FROM products WHERE seller_id = v_uid AND name = 'Sourdough Loaf';

  -- ============ Past batch 1: sold out fast (Brownie & Tart Friday, 12 units) ============
  v_friday := date_trunc('week', current_date)::date + 4; -- this week's Friday
  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason)
  VALUES (v_uid, 'Brownie & Tart Friday', v_friday - 14, 12, 'closed', 'sold_out')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_brownies, 0);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_tarts, 0);

  -- Orders with realistic timestamps, sold out within ~5 hours (total 12 units)
  v_t := (v_friday - 14)::timestamptz + interval '9 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Maya Lindqvist', '+1 555 201 4455', 'fulfilled', 30.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_brownies, 2, 15.00);

  v_t := (v_friday - 14)::timestamptz + interval '9 hours 40 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Omar Haddad', '+1 555 202 7761', 'fulfilled', 19.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 2, 9.50);

  v_t := (v_friday - 14)::timestamptz + interval '10 hours 30 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Priya Raman', '+1 555 203 9911', 'fulfilled', 15.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_brownies, 1, 15.00);

  v_t := (v_friday - 14)::timestamptz + interval '11 hours 15 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Tom Okafor', '+1 555 204 3320', 'fulfilled', 19.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 2, 9.50);

  v_t := (v_friday - 14)::timestamptz + interval '12 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Elena Petrova', '+1 555 205 8423', 'fulfilled', 30.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_brownies, 2, 15.00);

  v_t := (v_friday - 14)::timestamptz + interval '13 hours 50 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Jack Nguyen', '+1 555 206 1178', 'fulfilled', 24.50, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 1, 9.50);
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_brownies, 1, 15.00);

  v_t := (v_friday - 14)::timestamptz + interval '14 hours 20 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Sofia Marino', '+1 555 207 6654', 'fulfilled', 9.50, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 1, 9.50);

  -- ============ Past batch 2: sold out slower (Sourdough Saturday, 10 units) ============
  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason)
  VALUES (v_uid, 'Sourdough Saturday', v_friday - 7, 10, 'closed', 'sold_out')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_sourdough, 0);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_rolls, 0);

  -- Orders across ~8 hours (total 10 units)
  v_t := (v_friday - 7)::timestamptz + interval '9 hours';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Grace Chen', '+1 555 310 2214', 'fulfilled', 20.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 2, 10.00);

  v_t := (v_friday - 7)::timestamptz + interval '10 hours 25 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Liam Walsh', '+1 555 311 8890', 'fulfilled', 10.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 1, 10.00);

  v_t := (v_friday - 7)::timestamptz + interval '11 hours 50 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ada Nwosu', '+1 555 312 4471', 'fulfilled', 10.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 1, 10.00);

  v_t := (v_friday - 7)::timestamptz + interval '13 hours 40 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Noah Berger', '+1 555 313 6628', 'fulfilled', 20.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 2, 10.00);

  v_t := (v_friday - 7)::timestamptz + interval '15 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Isla Fontaine', '+1 555 314 9034', 'fulfilled', 24.00, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_rolls, 2, 12.00);

  v_t := (v_friday - 7)::timestamptz + interval '16 hours';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ravi Patel', '+1 555 315 2219', 'fulfilled', 10.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 1, 10.00);

  v_t := (v_friday - 7)::timestamptz + interval '16 hours 55 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Zoe Mitchell', '+1 555 316 7752', 'fulfilled', 10.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 1, 10.00);

  -- ============ Past batch 3: ~55% sold (Weekend Treat Box, 20 units, 11 sold) ============
  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason)
  VALUES (v_uid, 'Weekend Treat Box', v_friday - 3, 20, 'closed', 'expired')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_cupcakes, 2);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_tarts, 5);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_past_id, v_p_rolls, 2);

  v_t := (v_friday - 5)::timestamptz + interval '10 hours';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Hugo Silva', '+1 555 401 3387', 'fulfilled', 16.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_cupcakes, 2, 8.00);

  v_t := (v_friday - 5)::timestamptz + interval '11 hours 30 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Nora Fischer', '+1 555 402 5591', 'fulfilled', 19.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 2, 9.50);

  v_t := (v_friday - 5)::timestamptz + interval '13 hours 10 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Kofi Mensah', '+1 555 403 2246', 'fulfilled', 24.00, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_rolls, 2, 12.00);

  v_t := (v_friday - 4)::timestamptz + interval '9 hours 45 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Alice Kimura', '+1 555 404 9917', 'fulfilled', 8.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_cupcakes, 1, 8.00);

  v_t := (v_friday - 4)::timestamptz + interval '12 hours 20 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Dario Rossi', '+1 555 405 4482', 'fulfilled', 9.50, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 1, 9.50);

  v_t := (v_friday - 4)::timestamptz + interval '14 hours 55 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Freya Olsen', '+1 555 406 3395', 'fulfilled', 28.50, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_tarts, 3, 9.50);

  -- ============ Current open batch: Friday Drop (24 units, 4 pre-ordered) ============
  INSERT INTO batches (seller_id, title, pickup_date, capacity, status)
  VALUES (v_uid, 'Friday Drop — Maple & Crumb', v_friday + 7, 24, 'open')
  RETURNING id INTO v_batch_id;

  -- available + ordered = capacity: 6+6+4+0+4 = 20 available, 4 ordered
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_batch_id, v_p_cupcakes, 6);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_batch_id, v_p_tarts, 6);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_batch_id, v_p_rolls, 4);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_batch_id, v_p_brownies, 0);
  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES (v_batch_id, v_p_sourdough, 4);

  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders)
  VALUES (v_batch_id, '10:00', '12:00', 6), (v_batch_id, '17:00', '19:00', 6);

  -- A few fresh orders
  v_t := now() - interval '2 hours';
  INSERT INTO orders (batch_id, customer_name, phone, status, total, payment_status, created_at)
  VALUES (v_batch_id, 'Marta Kowalski', '+1 555 501 7788', 'pending', 16.00, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_cupcakes, 2, 8.00);

  v_t := now() - interval '1 hour';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_batch_id, 'Diego Alvarez', '+1 555 502 4410',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id LIMIT 1),
    'pending', 20.00, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (v_order_id, v_p_sourdough, 2, 10.00);

  -- Past-batch slots for prep realism
  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders)
  SELECT id, '10:00', '12:00', 10 FROM batches WHERE seller_id = v_uid AND status = 'closed';

  -- ============ Waitlist entries on the current batch ============
  INSERT INTO waitlist (batch_id, product_id, customer_name, phone, quantity)
  VALUES (v_batch_id, v_p_brownies, 'Willa Hart', '+1 555 340 1212', 1);

  INSERT INTO waitlist (batch_id, product_id, customer_name, phone, quantity)
  VALUES (v_batch_id, v_p_sourdough, 'Ben Carver', '+1 555 341 1313', 2);

  -- ============ Order codes for every seeded order ============
  FOR v_rec IN
    SELECT o.id FROM orders o
    JOIN batches b ON b.id = o.batch_id
    WHERE b.seller_id = v_uid AND o.code IS NULL
  LOOP
    v_code := '';
    FOR v_i IN 1..10 LOOP
      v_code := v_code || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', floor(random() * 31)::int + 1, 1);
    END LOOP;
    UPDATE orders SET code = v_code WHERE id = v_rec.id;
  END LOOP;
END;
$func$;

REVOKE ALL ON FUNCTION public.seed_demo_kitchen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_kitchen() TO authenticated;
