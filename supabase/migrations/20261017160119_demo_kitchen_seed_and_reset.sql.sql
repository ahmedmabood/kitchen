/*
# Demo kitchen: seed data + secure reset function

1. Plain-English summary
   Creates the Maple & Crumb demo kitchen with 5 products, one open batch on
   the next upcoming Friday (24 units across products), 3 pickup slots, and
   8 sample orders in mixed states. A `reset_demo_data()` function wipes and
   re-creates that batch's orders/items/slots and moves the pickup date to
   the next upcoming Friday. Only the demo user can run it. The demo seller
   row is locked (demo_locked = true) so it cannot be edited or deleted
   through normal owner policies.

2. Schema change
   - sellers.demo_locked boolean NOT NULL DEFAULT false.
   - Owner UPDATE/DELETE policies now exclude demo-locked rows.

3. Security
   - reset_demo_data(): SECURITY DEFINER, verifies auth.uid() is the demo
     user, locked search_path. RLS remains in force for all other access.
*/

-- ============ column ============

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS demo_locked boolean NOT NULL DEFAULT false;

-- ============ demo seller row ============

INSERT INTO sellers (id, shop_name, slug, bio, currency, pickup_address, whatsapp_number, demo_locked)
SELECT u.id, 'Maple & Crumb Home Bakery', 'maple-crumb',
  'Small-batch bakes from a home kitchen in Maplewood. Everything is mixed by hand, proofed overnight, and sold in limited Friday drops — when it''s gone, it''s gone.',
  'USD', 'Maplewood Neighborhood Market, Portland', '+1 555 013 9922', true
FROM auth.users u
WHERE u.email = 'demo@maplecrumb.batchly'
ON CONFLICT (id) DO NOTHING;

-- Normalize manually-created demo auth rows: GoTrue rejects password grants when
-- token columns are NULL or the email identity's provider_id isn't the user id.
UPDATE auth.users
SET confirmation_token = '',
    recovery_token = '',
    reauthentication_token = '',
    email_change = '',
    email_change_token_current = '',
    email_change_token_new = '',
    phone_change = '',
    phone_change_token = ''
WHERE email = 'demo@maplecrumb.batchly';

UPDATE auth.identities i
SET provider_id = i.user_id::text
FROM auth.users u
WHERE i.user_id = u.id
  AND u.email = 'demo@maplecrumb.batchly'
  AND i.provider = 'email'
  AND i.provider_id <> i.user_id::text;

-- ============ owner policies: demo-locked rows cannot self-update/delete ============

DROP POLICY IF EXISTS "sellers_update_own" ON sellers;
DROP POLICY IF EXISTS "sellers_delete_own" ON sellers;
CREATE POLICY "sellers_update_own" ON sellers FOR UPDATE
  TO authenticated USING (auth.uid() = id AND demo_locked = false)
  WITH CHECK (auth.uid() = id AND demo_locked = false);
CREATE POLICY "sellers_delete_own" ON sellers FOR DELETE
  TO authenticated USING (auth.uid() = id AND demo_locked = false);

-- ============ seed function (idempotent full reseed) ============

CREATE OR REPLACE FUNCTION seed_demo_kitchen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_batch_id uuid;
  v_p_cupcakes uuid; v_p_tarts uuid; v_p_rolls uuid; v_p_brownies uuid; v_p_sourdough uuid;
  v_friday date;
  v_order_id uuid;
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
END;
$$;

-- ============ reset function (demo user only) ============

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

-- ============ run the initial seed ============

SELECT seed_demo_kitchen();
