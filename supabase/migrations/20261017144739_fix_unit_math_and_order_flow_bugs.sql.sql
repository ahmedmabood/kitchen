/*
# Bug-fix migration: unit math, cancel idempotency, past-date orders, grants

1. Plain-English summary
   Fixes the known "-1 ordered" bug and tightens the order flow:
   - duplicate_batch copied the source batch's full capacity while copying
     the source's CURRENT (already ordered-down) units, so the copy's
     "ordered = capacity - units left" went negative. The duplicate now
     sets capacity to the sum of the units actually copied.
   - cancel_order raised an error on an already-cancelled order; it now
     treats that as a no-op success (idempotent).
   - place_order did not check the pickup date; customers could order from
     a batch whose pickup date had passed. It now refuses.
   - Defense in depth: anon role loses leftover table-level SELECT grants
     on orders/order_items (reads go through get_order_by_code / seller
     RLS policies only).

2. Security
   - No new policies; privilege tightening + function logic fixes only.
   - All functions remain SECURITY DEFINER with locked search_path and
     ownership checks.

3. Notes
   - Constraints for quantity >= 1, price >= 0, max_orders >= 1 and
     units_available >= 0 already exist in the core schema.
*/

-- ============ duplicate_batch: capacity must match copied units ============

CREATE OR REPLACE FUNCTION duplicate_batch(p_batch_id uuid, p_new_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src batches%ROWTYPE;
  v_new_id uuid;
  v_item batch_items%ROWTYPE;
  v_slot pickup_slots%ROWTYPE;
  v_units integer := 0;
BEGIN
  SELECT * INTO v_src FROM batches WHERE id = p_batch_id;
  IF NOT FOUND OR v_src.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;
  IF p_new_date IS NULL OR p_new_date < current_date THEN
    RAISE EXCEPTION 'INVALID_DATE';
  END IF;

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status)
  VALUES (auth.uid(), v_src.title, p_new_date, 0, 'open')
  RETURNING id INTO v_new_id;

  FOR v_item IN SELECT * FROM batch_items WHERE batch_id = p_batch_id LOOP
    INSERT INTO batch_items (batch_id, product_id, units_available)
    VALUES (v_new_id, v_item.product_id, v_item.units_available);
    v_units := v_units + v_item.units_available;
  END LOOP;

  FOR v_slot IN SELECT * FROM pickup_slots WHERE batch_id = p_batch_id LOOP
    INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders)
    VALUES (v_new_id, v_slot.start_time, v_slot.end_time, v_slot.max_orders);
  END LOOP;

  UPDATE batches SET capacity = v_units WHERE id = v_new_id;
  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_batch(uuid, date) TO authenticated;

-- ============ cancel_order: idempotent on already-cancelled ============

CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_batch batches%ROWTYPE;
  v_item order_items%ROWTYPE;
  v_units_after integer := 0;
  v_capacity integer := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN true;  -- idempotent: nothing to do
  END IF;
  IF v_order.status = 'fulfilled' THEN
    RAISE EXCEPTION 'ALREADY_FULFILLED';
  END IF;

  SELECT * INTO v_batch FROM batches WHERE id = v_order.batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_ORDER';
  END IF;

  UPDATE orders SET status = 'cancelled' WHERE id = p_order_id;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    UPDATE batch_items
    SET units_available = units_available + v_item.quantity
    WHERE batch_id = v_order.batch_id AND product_id = v_item.product_id;
  END LOOP;

  SELECT coalesce(sum(units_available), 0) INTO v_units_after FROM batch_items WHERE batch_id = v_order.batch_id;
  SELECT capacity INTO v_capacity FROM batches WHERE id = v_order.batch_id;
  IF v_capacity > 0 AND v_units_after > 0 THEN
    UPDATE batches SET status = 'open' WHERE id = v_order.batch_id AND status = 'closed';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_order(uuid) TO authenticated;

-- ============ place_order: refuse past pickup dates ============

CREATE OR REPLACE FUNCTION place_order(
  p_batch_id uuid,
  p_customer_name text,
  p_phone text,
  p_pickup_slot_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch batches%ROWTYPE;
  v_item jsonb;
  v_pid uuid;
  v_qty integer;
  v_bi batch_items%ROWTYPE;
  v_unit_price numeric;
  v_total numeric := 0;
  v_slot pickup_slots%ROWTYPE;
  v_slot_count integer := 0;
  v_code text;
  v_order_id uuid;
  v_remaining integer := 0;
  v_all_zero boolean := true;
BEGIN
  -- 1. Lock the batch and check status + date
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;
  IF v_batch.status <> 'open' THEN
    RAISE EXCEPTION 'BATCH_CLOSED';
  END IF;
  IF v_batch.pickup_date < current_date THEN
    RAISE EXCEPTION 'BATCH_CLOSED';
  END IF;

  -- 2. Validate customer info
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' OR length(btrim(p_customer_name)) > 80 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 500 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^[0-9+()\- ][0-9+()\- ]{6,19}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE';
  END IF;

  -- 3. Validate items payload
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ORDER';
  END IF;

  -- 4. Validate pickup slot (if provided) and its room
  IF p_pickup_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM pickup_slots
    WHERE id = p_pickup_slot_id AND batch_id = p_batch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLOT_NOT_FOUND';
    END IF;
    SELECT count(*) INTO v_slot_count FROM orders
    WHERE pickup_slot_id = p_pickup_slot_id AND status <> 'cancelled';
    IF v_slot_count >= v_slot.max_orders THEN
      RAISE EXCEPTION 'SLOT_FULL';
    END IF;
  END IF;

  -- 5. Deduct units with per-row locks; build order
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 50 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY';
    END IF;

    SELECT * INTO v_bi FROM batch_items
    WHERE batch_id = p_batch_id AND product_id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_IN_BATCH';
    END IF;
    IF v_bi.units_available < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNITS';
    END IF;

    SELECT price INTO v_unit_price FROM products WHERE id = v_pid;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
    END IF;

    UPDATE batch_items SET units_available = units_available - v_qty
    WHERE batch_id = p_batch_id AND product_id = v_pid
    RETURNING * INTO v_bi;

    v_total := v_total + (v_unit_price * v_qty);
    IF v_bi.units_available > 0 THEN
      v_all_zero := false;
    END IF;
  END LOOP;

  -- 6. Insert order + items
  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (p_batch_id, btrim(p_customer_name), btrim(p_phone), p_pickup_slot_id, 'pending', v_total, 'unpaid', p_notes)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    SELECT price INTO v_unit_price FROM products WHERE id = v_pid;
    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_pid, v_qty, v_unit_price);
  END LOOP;

  -- 7. Auto-close sold-out batches
  IF v_all_zero AND v_batch.capacity > 0 AND v_batch.status = 'open' THEN
    UPDATE batches SET status = 'closed' WHERE id = p_batch_id;
  END IF;

  -- 8. Generate unique code
  FOR i IN 1..5 LOOP
    v_code := '';
    FOR j IN 1..10 LOOP
      v_code := v_code || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', floor(random() * 31)::int + 1, 1);
    END LOOP;
    BEGIN
      UPDATE orders SET code = v_code WHERE id = v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF i = 5 THEN
        RAISE EXCEPTION 'CODE_GENERATION_FAILED';
      END IF;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION place_order(uuid, text, text, uuid, text, jsonb) TO anon, authenticated;

-- ============ tighten anon grants (defense in depth) ============

REVOKE SELECT ON orders FROM anon;
REVOKE SELECT ON order_items FROM anon;
