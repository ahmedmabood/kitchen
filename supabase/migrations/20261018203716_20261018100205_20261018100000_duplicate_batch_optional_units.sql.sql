/*
# duplicate_batch: optional unit overrides (used by Batch Pulse plan suggestions)

1. Summary
- Extends `duplicate_batch` with an optional per-product unit map so the
  "Plan your next batch" suggestion can prefill a duplicated batch's units.
- Existing callers are unaffected: when `p_units` is NULL (or a product is
  missing from the map), the copy uses the source batch's units as before.

2. Function changes
- `duplicate_batch(p_batch_id uuid, p_new_date date, p_units jsonb DEFAULT NULL)`
  - `p_units` shape: `{"<product_id>": <units>, ...}`.
  - Validation: keys must be product ids in the source batch; values must be
    integers between 1 and 999. Invalid entries raise `INVALID_UNITS` and abort.

3. Security
- SECURITY DEFINER with `SET search_path = public` (unchanged).
- Ownership check unchanged (`seller_id <> auth.uid()` raises NOT_YOUR_BATCH).
- EXECUTE re-granted to `authenticated` only; revoked from `anon`/`PUBLIC`.
*/

CREATE OR REPLACE FUNCTION duplicate_batch(p_batch_id uuid, p_new_date date, p_units jsonb DEFAULT NULL)
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
  v_pid uuid;
  v_qty integer;
  v_units_left integer;
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

  SELECT coalesce(sum(units_available), 0) INTO v_units_left
  FROM batch_items WHERE batch_id = p_batch_id;

  FOR v_item IN SELECT * FROM batch_items WHERE batch_id = p_batch_id LOOP
    v_qty := v_item.units_available;
    IF p_units IS NOT NULL THEN
      v_qty := coalesce((p_units ->> v_item.product_id::text)::int, v_item.units_available);
      IF v_qty IS NULL OR v_qty < 1 OR v_qty > 999 THEN
        RAISE EXCEPTION 'INVALID_UNITS';
      END IF;
    END IF;
    INSERT INTO batch_items (batch_id, product_id, units_available)
    VALUES (v_new_id, v_item.product_id, v_qty);
    v_units := v_units + v_qty;
  END LOOP;

  FOR v_slot IN SELECT * FROM pickup_slots WHERE batch_id = p_batch_id LOOP
    INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders)
    VALUES (v_new_id, v_slot.start_time, v_slot.end_time, v_slot.max_orders);
  END LOOP;

  UPDATE batches SET capacity = v_units WHERE id = v_new_id;
  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_batch(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION duplicate_batch(uuid, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION duplicate_batch(uuid, date) FROM anon, PUBLIC;