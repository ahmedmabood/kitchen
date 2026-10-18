/*
# Reopen rules: track why a batch was closed; reopen only sold-out closures

1. Plain-English summary
   Batches close for two different reasons: they sold out, or the seller
   closed them by hand. Only a sold-out closure should ever flip back open
   on its own when an order is cancelled — and even then only if units are
   actually available again and the pickup date is still in the future.
   A batch the seller closed manually must never reopen by itself.
   Orders placed against a batch whose pickup date has passed are already
   refused by place_order; this migration also blocks direct table updates
   from ever reopening a batch whose date has passed.

2. Schema change
   - batches.closed_reason: 'sold_out' | 'manual' | 'expired' | NULL
     (NULL = open). Set on every close; cleared on reopen.

3. Function changes
   - place_order: when auto-closing a sold-out batch, record closed_reason
     = 'sold_out'.
   - cancel_order: after returning units, reopen ONLY if the batch was
     closed because it sold out, units are available again, and the pickup
     date is in the future. Manual/expired closures stay closed.
   - reopen_batch (seller manual reopen): still works as before; also
     refuses if the pickup date has passed, and clears closed_reason.

4. Security
   - No policy changes. Functions stay SECURITY DEFINER with locked
     search_path and owner checks.
*/

-- ============ new column ============

ALTER TABLE batches ADD COLUMN IF NOT EXISTS closed_reason text
  CHECK (closed_reason IN ('sold_out','manual','expired'));

-- ============ backfill: infer reason for currently closed batches ============

UPDATE batches b
SET closed_reason = CASE
  WHEN b.pickup_date < current_date THEN 'expired'
  WHEN EXISTS (SELECT 1 FROM batch_items bi WHERE bi.batch_id = b.id AND bi.units_available > 0)
    THEN 'manual'
  ELSE 'sold_out'
END
WHERE b.status = 'closed' AND b.closed_reason IS NULL;

-- ============ place_order: tag sold-out auto-closures ============

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

  -- 7. Auto-close sold-out batches, remembering why
  IF v_all_zero AND v_batch.capacity > 0 AND v_batch.status = 'open' THEN
    UPDATE batches SET status = 'closed', closed_reason = 'sold_out' WHERE id = p_batch_id;
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

-- ============ cancel_order: reopen only sold-out closures, future date ============

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

  -- Reopen only sold-out closures, only with real units back, only if the
  -- pickup date is still in the future. Never reopen manual/expired closes.
  IF v_batch.status = 'closed'
     AND v_batch.closed_reason = 'sold_out'
     AND v_capacity > 0
     AND v_units_after > 0
     AND v_batch.pickup_date >= current_date THEN
    UPDATE batches SET status = 'open', closed_reason = NULL WHERE id = v_order.batch_id;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_order(uuid) TO authenticated;

-- ============ reopen_batch (manual): clear reason, respect past dates ============

CREATE OR REPLACE FUNCTION reopen_batch(p_batch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch batches%ROWTYPE;
  v_units integer := 0;
BEGIN
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;
  IF v_batch.pickup_date < current_date THEN
    RAISE EXCEPTION 'PICKUP_DATE_PASSED';
  END IF;
  IF v_batch.status = 'open' THEN
    RETURN true;
  END IF;

  SELECT coalesce(sum(units_available), 0) INTO v_units FROM batch_items WHERE batch_id = p_batch_id;
  IF v_units <= 0 THEN
    RAISE EXCEPTION 'NO_UNITS_LEFT';
  END IF;

  UPDATE batches SET status = 'open', closed_reason = NULL WHERE id = p_batch_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION reopen_batch(uuid) TO authenticated;
