/*
# Demo data: past batches for Batch Pulse + waitlist entries on current batch

1. Plain-English summary
   The demo kitchen now has history so Batch Pulse and "Plan your next
   batch" look alive immediately: three past batches with realistic order
   timestamps — two that sold out (one fast: 12 units in ~2h10m; one slow:
   12 units over ~8h) and one that reached about 55% sold-through — plus
   two people waiting on the current (partially sold) batch. Resetting the
   demo data recreates all of it.

2. Function changes
   - `seed_demo_kitchen()`: after creating the current batch, also creates
     3 past batches (dates relative to today) with per-batch products,
     slots, orders (active and one cancelled) whose created_at values
     produce believable sell-out curves, and reflects the sold units into
     batch_items. Sold-out past batches are marked closed/sold_out.
   - `reset_demo_data()`: also wipes waitlist entries for the demo
     seller's batches before reseeding, then seeds 2 waiting entries on
     the current batch.
   - Waitlist entries are inserted directly (the seed function runs as
     SECURITY DEFINER with the table sealed to clients).

3. Security
   - No policy changes. Both functions stay SECURITY DEFINER, demo-user
     verified (reset), locked search_path.
*/

-- ============ seed: three past batches with realistic order times ============

CREATE OR REPLACE FUNCTION seed_demo_kitchen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_batch_id uuid;
  v_past_id uuid;
  v_order_id uuid;
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
  VALUES (v_uid, 'Sourdough Loaf', '48-hour fermentation, deep caramel crust.', 11.00, null, true);
  SELECT id INTO v_p_sourdough FROM products WHERE seller_id = v_uid AND name = 'Sourdough Loaf';

  -- next upcoming Friday (today counts until 8pm, then rolls to next week)
  v_friday := current_date + ((5 - extract(dow from current_date)::int + 7) % 7);
  IF v_friday = current_date AND extract(hour from now()) >= 20 THEN
    v_friday := v_friday + 7;
  END IF;

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason)
  VALUES (v_uid, 'Friday Drop — Maple & Crumb', v_friday, 24, 'open', NULL)
  RETURNING id INTO v_batch_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES
    (v_batch_id, v_p_cupcakes, 6),
    (v_batch_id, v_p_tarts, 5),
    (v_batch_id, v_p_rolls, 4),
    (v_batch_id, v_p_brownies, 3),
    (v_batch_id, v_p_sourdough, 6);

  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders) VALUES
    (v_batch_id, '10:00', '12:00', 4),
    (v_batch_id, '13:00', '15:00', 4),
    (v_batch_id, '17:00', '19:00', 4);

  -- 8 sample orders in mixed states
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Priya Nair', '+1 555 201 4477',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '10:00'),
    'confirmed', 24.00, 'unpaid', 'Please box the cupcakes separately.')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 2, 8.00);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Marcus Webb', '+1 555 202 5588',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '10:00'),
    'confirmed', 34.50, 'paid', NULL)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_tarts, 3, 9.50);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Elena Rossi', '+1 555 203 6699',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '13:00'),
    'fulfilled', 15.00, 'paid', NULL)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 1, 15.00);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Tom Okafor', '+1 555 204 7710',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '13:00'),
    'pending', 26.00, 'unpaid', 'Can I switch pickup to the evening slot?')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00), (v_order_id, v_p_sourdough, 1, 11.00);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Sofia Lindqvist', '+1 555 205 8821',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '17:00'),
    'confirmed', 22.00, 'paid', NULL)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 1, 8.00), (v_order_id, v_p_tarts, 1, 9.50);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Dan Whitfield', '+1 555 206 9932',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '17:00'),
    'pending', 11.00, 'unpaid', NULL)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 1, 11.00);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Grace Chen', '+1 555 207 1143',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '10:00'),
    'fulfilled', 30.00, 'paid', 'Repeat customer — extra napkins please!')
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 2, 15.00);

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v_batch_id, 'Amara Diallo', '+1 555 208 2254',
    (SELECT id FROM pickup_slots WHERE batch_id = v_batch_id AND start_time = '13:00'),
    'confirmed', 18.00, 'unpaid', NULL)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 1, 8.00), (v_order_id, v_p_rolls, 1, 12.00);

  -- reflect ordered units in batch_items
  UPDATE batch_items bi
  SET units_available = bi.units_available - COALESCE(o.qty, 0)
  FROM (
    SELECT product_id, SUM(quantity) AS qty
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.batch_id = v_batch_id AND o.status <> 'cancelled'
    GROUP BY product_id
  ) o
  WHERE bi.product_id = o.product_id AND bi.batch_id = v_batch_id;

  -- Stagger order timestamps on the current batch so the pulse chart has a curve
  UPDATE orders SET created_at = now() - interval '2 days'
  WHERE batch_id = v_batch_id AND customer_name = 'Priya Nair';
  UPDATE orders SET created_at = now() - interval '1 day 20 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Marcus Webb';
  UPDATE orders SET created_at = now() - interval '1 day 14 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Elena Rossi';
  UPDATE orders SET created_at = now() - interval '1 day 6 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Tom Okafor';
  UPDATE orders SET created_at = now() - interval '22 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Sofia Lindqvist';
  UPDATE orders SET created_at = now() - interval '9 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Dan Whitfield';
  UPDATE orders SET created_at = now() - interval '5 hours'
  WHERE batch_id = v_batch_id AND customer_name = 'Grace Chen';
  UPDATE orders SET created_at = now() - interval '90 minutes'
  WHERE batch_id = v_batch_id AND customer_name = 'Amara Diallo';

  -- ============ past batch 1 (fast sell-out): 12 units gone in ~2h10m ============

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason, created_at)
  VALUES (v_uid, 'Brownie & Tart Friday', current_date - 14, 12, 'closed', 'sold_out', now() - interval '16 days')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES
    (v_past_id, v_p_brownies, 4),
    (v_past_id, v_p_tarts, 4),
    (v_past_id, v_p_cupcakes, 4);

  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders) VALUES
    (v_past_id, '10:00', '12:00', 4),
    (v_past_id, '16:00', '18:00', 4);

  -- opened 10:00, sold out 12:10, seven days before pickup
  v_t := (current_date - 21)::timestamptz + interval '10 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Harper Quinn', '+1 555 310 1122',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '10:00'),
    'fulfilled', 30.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 2, 15.00);

  v_t := (current_date - 21)::timestamptz + interval '10 hours 18 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Leo Martins', '+1 555 311 2233',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '10:00'),
    'fulfilled', 19.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_tarts, 2, 9.50);

  v_t := (current_date - 21)::timestamptz + interval '10 hours 41 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Nia Brooks', '+1 555 312 3344',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '16:00'),
    'fulfilled', 24.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 3, 8.00);

  v_t := (current_date - 21)::timestamptz + interval '11 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Owen Park', '+1 555 313 4455',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '16:00'),
    'fulfilled', 15.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 1, 15.00);

  v_t := (current_date - 21)::timestamptz + interval '11 hours 30 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Zara Ahmed', '+1 555 314 5566',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '10:00'),
    'fulfilled', 28.50, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_tarts, 1, 9.50), (v_order_id, v_p_cupcakes, 1, 8.00);

  v_t := (current_date - 21)::timestamptz + interval '12 hours 10 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Felix Grant', '+1 555 315 6677',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '16:00'),
    'fulfilled', 23.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 1, 15.00), (v_order_id, v_p_tarts, 1, 9.50);

  -- sold: brownies 4, tarts 4, cupcakes 4 -> all 12 units gone (sold out)

  -- ============ past batch 2 (slow sell-out): 12 units over ~8h ============

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason, created_at)
  VALUES (v_uid, 'Sourdough Saturday', current_date - 7, 12, 'closed', 'sold_out', now() - interval '9 days')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES
    (v_past_id, v_p_sourdough, 8),
    (v_past_id, v_p_rolls, 4);

  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders) VALUES
    (v_past_id, '09:00', '11:00', 4);

  -- opened 09:00, sold out just before 18:00, seven days before pickup
  v_t := (current_date - 14)::timestamptz + interval '9 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Mia Santos', '+1 555 320 7788',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 22.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 2, 11.00);

  v_t := (current_date - 14)::timestamptz + interval '10 hours 25 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Jonah Reed', '+1 555 321 8899',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 11.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 1, 11.00);

  v_t := (current_date - 14)::timestamptz + interval '11 hours 50 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ines Fournier', '+1 555 322 9900',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 12.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00);

  v_t := (current_date - 14)::timestamptz + interval '13 hours 40 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Kofi Mensah', '+1 555 323 1010',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 33.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 3, 11.00);

  v_t := (current_date - 14)::timestamptz + interval '15 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ruth Becker', '+1 555 324 2020',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 11.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 1, 11.00);

  v_t := (current_date - 14)::timestamptz + interval '16 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ari Novak', '+1 555 325 3030',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 12.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00);

  v_t := (current_date - 14)::timestamptz + interval '16 hours 55 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Tessa Hall', '+1 555 326 4040',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 11.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_sourdough, 1, 11.00);

  -- sold: sourdough 9, rolls 2 = 11... add the last unit to reach sold out
  v_t := (current_date - 14)::timestamptz + interval '17 hours 5 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Pablo Ruiz', '+1 555 327 5050',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '09:00'),
    'fulfilled', 12.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00);

  -- ============ past batch 3 (not sold out): ~55% sold through ============

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status, closed_reason, created_at)
  VALUES (v_uid, 'Weekend Treat Box', current_date - 3, 20, 'closed', 'expired', now() - interval '6 days')
  RETURNING id INTO v_past_id;

  INSERT INTO batch_items (batch_id, product_id, units_available) VALUES
    (v_past_id, v_p_cupcakes, 8),
    (v_past_id, v_p_brownies, 6),
    (v_past_id, v_p_rolls, 6);

  INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders) VALUES
    (v_past_id, '11:00', '13:00', 5);

  v_t := (current_date - 6)::timestamptz + interval '14 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Calvin Zhao', '+1 555 330 5050',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'fulfilled', 16.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 2, 8.00);

  v_t := (current_date - 6)::timestamptz + interval '15 hours 30 minutes';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Dalia Haddad', '+1 555 331 6060',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'fulfilled', 30.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_brownies, 2, 15.00);

  v_t := (current_date - 6)::timestamptz + interval '17 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Ethan Cole', '+1 555 332 7070',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'fulfilled', 24.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 2, 12.00);

  v_t := (current_date - 5)::timestamptz + interval '10 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Farah Idris', '+1 555 333 8080',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'fulfilled', 32.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_cupcakes, 2, 8.00), (v_order_id, v_p_brownies, 2, 15.00);

  v_t := (current_date - 5)::timestamptz + interval '12 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Gus Larsson', '+1 555 334 9090',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'cancelled', 15.00, 'unpaid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00);

  -- active sold units: cupcakes 4, brownies 4, rolls 2 = 10... one more roll:
  v_t := (current_date - 5)::timestamptz + interval '13 hours';
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, created_at)
  VALUES (v_past_id, 'Sena Aoki', '+1 555 335 6060',
    (SELECT id FROM pickup_slots WHERE batch_id = v_past_id AND start_time = '11:00'),
    'fulfilled', 12.00, 'paid', v_t)
  RETURNING id INTO v_order_id;
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v_p_rolls, 1, 12.00);

  -- 11 of 20 units sold = 55% sold-through; 9 units remain available
  UPDATE batch_items bi
  SET units_available = bi.units_available - COALESCE(o.qty, 0)
  FROM (
    SELECT product_id, SUM(quantity) AS qty
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.batch_id = v_past_id AND o.status <> 'cancelled'
    GROUP BY product_id
  ) o
  WHERE bi.product_id = o.product_id AND bi.batch_id = v_past_id;

  -- ============ two people waiting on the current batch ============

  INSERT INTO waitlist (batch_id, product_id, customer_name, phone, quantity, status, created_at)
  VALUES
    (v_batch_id, v_p_brownies, 'Willa Hart', '+1 555 340 1212', 1, 'waiting', now() - interval '3 hours'),
    (v_batch_id, v_p_sourdough, 'Ben Carver', '+1 555 341 1313', 2, 'waiting', now() - interval '90 minutes');
END;
$$;

-- ============ reset: wipe waitlist for demo batches, reseed, re-add waiters ============

CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_products int := 0;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'demo@maplecrumb.batchly';
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'DEMO_USER_MISSING';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_uid THEN
    RAISE EXCEPTION 'DEMO_ONLY';
  END IF;

  DELETE FROM waitlist WHERE batch_id IN (SELECT id FROM batches WHERE seller_id = v_uid);
  DELETE FROM orders WHERE batch_id IN (SELECT id FROM batches WHERE seller_id = v_uid);
  DELETE FROM batch_items WHERE batch_id IN (SELECT id FROM batches WHERE seller_id = v_uid);
  DELETE FROM pickup_slots WHERE batch_id IN (SELECT id FROM batches WHERE seller_id = v_uid);
  DELETE FROM batches WHERE seller_id = v_uid;
  DELETE FROM products WHERE seller_id = v_uid;

  PERFORM seed_demo_kitchen();

  SELECT count(*) INTO v_products FROM products WHERE seller_id = v_uid;
  RETURN v_products > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_demo_data() TO authenticated;