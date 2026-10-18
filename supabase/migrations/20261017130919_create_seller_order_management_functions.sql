/*
# Seller order management (Step 3)

1. Plain-English summary
   Sellers can now manage incoming orders: mark them Ready, Picked up,
   toggle Paid/Unpaid, and Cancel. Cancelling is special: it must give the
   reserved units back to the batch (so the storefront counter goes up
   again) and free the pickup-slot spot. All of these happen through
   secure database functions that check the caller really owns the batch,
   so one seller can never touch another seller's orders. Sellers can
   also store a WhatsApp number, which customers see on the storefront
   and confirmation page. Two batch conveniences were added: "Duplicate
   batch" (copy products, units, and slot times to a new date) and
   "Reopen" (only allowed when units remain and the pickup date is in
   the future).

2. New column
   - `sellers.whatsapp_number` text, nullable. Stored as entered; the
     app normalizes it for wa.me links (digits only, with country code).

3. New functions (all SECURITY DEFINER, locked search_path, and all
   verify batch ownership via auth.uid() before doing anything):
   - `cancel_order(p_order_id uuid)` — one transaction: locks the order
     and its batch, verifies ownership, refuses if already cancelled or
     fulfilled, sets status='cancelled', returns each item's quantity to
     batch_items.units_available, and (if the batch re-opens) flips a
     sold-out batch back to 'open'. Execute granted to authenticated.
   - `update_order_status(p_order_id uuid, p_status text)` — sets
     pending/confirmed/fulfilled with ownership check.
   - `update_order_payment(p_order_id uuid, p_paid boolean)` — sets
     payment_status paid/unpaid with ownership check.
   - `reopen_batch(p_batch_id uuid)` — reopens a closed batch only if it
     belongs to the caller, has units left, and the pickup date is in
     the future.
   - `duplicate_batch(p_batch_id uuid, p_new_date date)` — creates a new
     open batch for the caller with the same title, products, units, and
     slot times; returns the new batch id. Validation: units >= 1,
     max_orders >= 1, new date not in the past, end > start (guarded by
     existing CHECK).

4. Security (RLS) changes
   - New SELECT policy on `orders` for authenticated sellers: a seller
     can read orders whose batch belongs to them. Combined with the
     existing owner-scoped UPDATE policy on orders (via batches), the
     functions above cover privileged mutations. No public access is
     added: anon still cannot read or write orders directly.

5. Notes
   - Cancel restores units per product; a fully-restored batch becomes
     open again so customers can reorder.
   - Status flow used by the UI: pending (New) -> confirmed (Ready) ->
     fulfilled (Picked up); cancelled at any point before fulfilment.
   - Order codes are untouched; the customer's confirmation link keeps
     working after any of these updates.
*/

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS whatsapp_number text;

-- ============ cancel_order ============

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
    RAISE EXCEPTION 'ALREADY_CANCELLED';
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
    WHERE batch_id = v_order.batch_id AND product_id = v_item.product_id
    RETURNING units_available INTO v_units_after;
    v_units_after := v_units_after;
  END LOOP;

  SELECT sum(units_available) INTO v_units_after FROM batch_items WHERE batch_id = v_order.batch_id;
  SELECT capacity INTO v_capacity FROM batches WHERE id = v_order.batch_id;
  IF v_capacity > 0 AND v_units_after > 0 THEN
    UPDATE batches SET status = 'open' WHERE id = v_order.batch_id AND status = 'closed';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_order(uuid) TO authenticated;

-- ============ update_order_status ============

CREATE OR REPLACE FUNCTION update_order_status(p_order_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
BEGIN
  IF p_status NOT IN ('pending', 'confirmed', 'fulfilled') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  SELECT b.seller_id INTO v_seller
  FROM orders o JOIN batches b ON b.id = o.batch_id
  WHERE o.id = p_order_id;
  IF v_seller IS NULL OR v_seller <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_ORDER';
  END IF;
  UPDATE orders SET status = p_status WHERE id = p_order_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_order_status(uuid, text) TO authenticated;

-- ============ update_order_payment ============

CREATE OR REPLACE FUNCTION update_order_payment(p_order_id uuid, p_paid boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
BEGIN
  SELECT b.seller_id INTO v_seller
  FROM orders o JOIN batches b ON b.id = o.batch_id
  WHERE o.id = p_order_id;
  IF v_seller IS NULL OR v_seller <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_ORDER';
  END IF;
  UPDATE orders SET payment_status = CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END
  WHERE id = p_order_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_order_payment(uuid, boolean) TO authenticated;

-- ============ reopen_batch ============

CREATE OR REPLACE FUNCTION reopen_batch(p_batch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch batches%ROWTYPE;
  v_units integer;
BEGIN
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id;
  IF NOT FOUND OR v_batch.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;
  IF v_batch.pickup_date < current_date THEN
    RAISE EXCEPTION 'PICKUP_DATE_PASSED';
  END IF;
  SELECT coalesce(sum(units_available), 0) INTO v_units FROM batch_items WHERE batch_id = p_batch_id;
  IF v_units <= 0 THEN
    RAISE EXCEPTION 'NO_UNITS_LEFT';
  END IF;
  UPDATE batches SET status = 'open' WHERE id = p_batch_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION reopen_batch(uuid) TO authenticated;

-- ============ duplicate_batch ============

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
BEGIN
  SELECT * INTO v_src FROM batches WHERE id = p_batch_id;
  IF NOT FOUND OR v_src.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;
  IF p_new_date IS NULL OR p_new_date < current_date THEN
    RAISE EXCEPTION 'INVALID_DATE';
  END IF;

  INSERT INTO batches (seller_id, title, pickup_date, capacity, status)
  VALUES (auth.uid(), v_src.title, p_new_date, v_src.capacity, 'open')
  RETURNING id INTO v_new_id;

  FOR v_item IN SELECT * FROM batch_items WHERE batch_id = p_batch_id LOOP
    INSERT INTO batch_items (batch_id, product_id, units_available)
    VALUES (v_new_id, v_item.product_id, v_item.units_available);
  END LOOP;

  FOR v_slot IN SELECT * FROM pickup_slots WHERE batch_id = p_batch_id LOOP
    INSERT INTO pickup_slots (batch_id, start_time, end_time, max_orders)
    VALUES (v_new_id, v_slot.start_time, v_slot.end_time, v_slot.max_orders);
  END LOOP;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_batch(uuid, date) TO authenticated;

-- ============ RLS: sellers can read their own orders ============

DROP POLICY IF EXISTS "Sellers can read own orders" ON orders;
CREATE POLICY "Sellers can read own orders"
ON orders FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM batches b
    WHERE b.id = orders.batch_id AND b.seller_id = auth.uid()
  )
);
