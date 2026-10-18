/*
# Fix: premature batch auto-close when only some items hit zero

## Problem
`place_order` tracked `v_all_zero` by checking only the items that appeared
in the *current order*. If a customer bought, say, all 4 Cinnamon Rolls but
did not include Chocolate Cupcakes or Lemon Tarts, the variable became true
for the items they ordered, and the batch was incorrectly closed — even though
other products still had units available. Subsequent buyers then hit
"BATCH_CLOSED" despite seeing stock on the storefront.

## Fix
After deducting units, query the batch_items table for the entire batch and
check whether every row has units_available = 0. Only close the batch when
that global check is true. The local `v_all_zero` variable is removed; the
check is replaced with a SQL `bool_and(units_available = 0)` sub-select.

## Security
No privilege changes. Function stays SECURITY DEFINER with locked search_path.
The execute grant to anon + authenticated is re-applied for completeness.
*/

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
  v_batch_all_zero boolean;
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
    IF v_batch.pickup_date = current_date AND v_slot.end_time <= now()::time THEN
      RAISE EXCEPTION 'SLOT_FULL';
    END IF;
    IF v_slot_count >= v_slot.max_orders THEN
      RAISE EXCEPTION 'SLOT_FULL';
    END IF;
  END IF;

  -- 5. Deduct units with per-row locks; build order total
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

  -- 7. Auto-close only when EVERY item across the WHOLE batch is at zero.
  --    (Previous versions tracked only the items in this order, causing a
  --    premature close when a partial order emptied just one product.)
  SELECT bool_and(units_available = 0)
  INTO v_batch_all_zero
  FROM batch_items
  WHERE batch_id = p_batch_id;

  IF v_batch_all_zero AND v_batch.capacity > 0 AND v_batch.status = 'open' THEN
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

-- Also reopen the current batch if it was incorrectly closed by the old bug
-- (i.e., it is closed with reason='sold_out' but still has units available).
UPDATE batches b
SET status = 'open', closed_reason = NULL
WHERE b.status = 'closed'
  AND b.closed_reason = 'sold_out'
  AND b.pickup_date >= current_date
  AND EXISTS (
    SELECT 1 FROM batch_items bi
    WHERE bi.batch_id = b.id AND bi.units_available > 0
  );