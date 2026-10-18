/*
# Secure order placement (RPC) + public order lookup by code

1. Plain-English summary
   Customers can now place pre-orders on a public storefront without an
   account. This migration creates a single secure database function,
   `place_order`, that is the ONLY way to create an order. The browser is
   never allowed to write to the orders tables directly. The function runs
   as one atomic transaction: it re-checks everything (batch open, units
   left, slot room), deducts the units, creates the order, and returns a
   random, hard-to-guess order code. If two customers try to buy the last
   unit at the same moment, exactly one succeeds — the other gets a clear
   error so they can adjust their cart. It also adds a `code` column on
   orders and lets anyone who has a valid code read just that one order.

2. New columns
   - `orders.code`  text, unique. A random 10-character code made of
                    unambiguous characters (no 0/O/1/I), generated inside
                    `place_order` with up to 5 retries to guarantee
                    uniqueness. This is what appears in the URL
                    /order/[code] and in the customer's confirmation.

3. New function: `place_order` (SECURITY DEFINER)
   Inputs (JSON): p_batch_id (uuid), p_customer_name (text),
   p_phone (text), p_pickup_slot_id (uuid, optional),
   p_notes (text, optional), p_items (JSON array of
   {product_id, quantity}).
   Steps, all inside ONE transaction with row-level locking
   (SELECT ... FOR UPDATE) so concurrent orders cannot over-sell:
     1. Look up the batch FOR UPDATE; fail if it does not exist or its
        status is not 'open'.
     2. Validate customer name (1-80 chars) and phone (7-20 chars,
        digits/spaces/+-() only). Fail with a clear message otherwise.
     3. If a pickup slot was chosen, verify it belongs to the batch and
        count existing orders against its max_orders; fail if full.
     4. For each item: lock the batch_item row FOR UPDATE, verify the
        product is in the batch and units_available >= requested
        quantity. Deduct the quantity from units_available.
     5. Create the orders row (total = sum of quantity x product price,
        computed server-side from the products table — never trusted
        from the client) and its order_items rows.
     6. If every item's units_available is now 0 (and the batch had
        capacity), set the batch status to 'closed' (shown as "Sold
        out"). This is the automatic sell-out behavior.
     7. Generate and return the order code.
   Errors are raised with distinct messages; the frontend maps the
   "insufficient units" message to the friendly
   "Sorry, someone just grabbed the last one..." copy.
   Execute privilege is granted to anon and authenticated (that is the
   whole point — customers are not logged in). The function is SECURITY
   DEFINER with a locked search_path, which is safe because it validates
   all inputs itself and never exposes other rows.

4. New function: `get_order_by_code` (SECURITY DEFINER)
   Input: p_code (text). Returns exactly one order (code, customer
   first-given info, items with product names/prices, total, pickup
   date, slot window, pickup address, shop name/slug/currency, batch
   title, status, payment status) — but ONLY if the code matches.
   There is no way to list orders publicly: no args = no rows. Execute
   granted to anon + authenticated.

5. Security (row level security) changes
   - `orders`:  anon/public now has NO insert, update, or delete. SELECT
     for anon is NOT granted via policies (public reads go through
     `get_order_by_code` instead, which cannot be used to enumerate).
     The seller's existing owner-scoped policies remain.
   - `order_items`: no new public policies (no public access).
   - Explicit GRANT/REVOKE: anon and authenticated get no direct table
     privileges on orders/order_items beyond what policies already
     restricted; INSERT is explicitly revoked from anon and
     authenticated on both tables to guarantee no open public inserts.

6. Notes
   - Capacity race safety: FOR UPDATE locks on batches, batch_items and
     counting of slot orders inside the same transaction make
     double-spending the last unit impossible.
   - Order codes are random and unguessable (10 chars from a 31-char
     alphabet ≈ 8.7e14 combinations) and are never sequential.
*/

-- ============ Column ============

ALTER TABLE orders ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_code ON orders(code);

-- ============ place_order ============

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
  -- 1. Lock the batch and check status
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;
  IF v_batch.status <> 'open' THEN
    RAISE EXCEPTION 'BATCH_CLOSED';
  END IF;

  -- 2. Validate customer info
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' OR length(btrim(p_customer_name)) > 80 THEN
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
    v_remaining := v_remaining + v_bi.units_available;
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
  IF v_all_zero AND v_remaining = 0 AND v_batch.capacity > 0 AND v_batch.status = 'open' THEN
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

-- ============ get_order_by_code ============

CREATE OR REPLACE FUNCTION get_order_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{10}$' THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'code', o.code,
    'customer_name', o.customer_name,
    'status', o.status,
    'total', o.total,
    'payment_status', o.payment_status,
    'notes', o.notes,
    'created_at', o.created_at,
    'shop_name', s.shop_name,
    'shop_slug', s.slug,
    'currency', s.currency,
    'pickup_address', s.pickup_address,
    'batch_title', b.title,
    'pickup_date', b.pickup_date,
    'pickup_start', ps.start_time,
    'pickup_end', ps.end_time,
    'items', (
      SELECT jsonb_agg(jsonb_build_object(
        'name', p.name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price
      ))
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = o.id
    )
  )
  INTO v_result
  FROM orders o
  JOIN batches b ON b.id = o.batch_id
  JOIN sellers s ON s.id = b.seller_id
  LEFT JOIN pickup_slots ps ON ps.id = o.pickup_slot_id
  WHERE o.code = upper(p_code);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_order_by_code(text) TO anon, authenticated;

-- ============ No open public inserts ============

REVOKE INSERT ON orders FROM anon, authenticated;
REVOKE INSERT ON order_items FROM anon, authenticated;
REVOKE UPDATE ON orders FROM anon;
