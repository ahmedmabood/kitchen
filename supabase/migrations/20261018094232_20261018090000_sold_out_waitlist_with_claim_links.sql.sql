/*
# Feature: Sold-out waitlist with claim links

1. Plain-English summary
   When a batch sells out, customers can join a waitlist (name, phone, 1-4
   units of a product). When units become free again — an order is cancelled
   or the seller adds units — the oldest waiting entry that fits is
   automatically "offered" the units: those units are HELD (nobody else can
   order them) for 30 minutes, and the customer gets a private claim link.
   If they don't claim in time, the units are released and offered to the
   next person in line. The seller sees the waitlist on the Orders page and
   can send the claim link on WhatsApp or skip an entry.

2. New table
   - `waitlist`: id, batch_id (cascade delete), product_id, customer_name,
     phone, quantity (1-4), status ('waiting'|'offered'|'claimed'|'expired'),
     claim_code (unique, 12 chars), offered_at, offer_expires_at, created_at.

3. Unit balance invariant
   available + held + ordered = capacity always holds: an offer deducts the
   quantity from batch_items.units_available (the same field orders deduct
   from), so held units are never double-sold. Existing CHECK
   (units_available >= 0) guarantees nothing goes negative; the offer logic
   only holds units it has verified are free, under row locks.

4. Security (RLS + privileges)
   - RLS enabled on `waitlist` with NO policies: nobody reads or writes it
     through the Data API, even with the anon key.
   - All table privileges revoked from anon/authenticated; access only via
     SECURITY DEFINER functions (locked search_path):
     * join_waitlist (anon+authenticated): validates input, inserts a
       waiting entry. Cannot read anything back.
     * process_waitlist (anon+authenticated): expires stale offers (returns
       their units), then offers free units to the oldest fitting waiter.
       Called on storefront / orders page / claim page load — no cron.
     * get_waitlist_offer (anon+authenticated): claim-page lookup by claim
       code only; returns just what the claim page needs.
     * claim_waitlist_order (anon+authenticated): validates the offer is
       still live, creates the order from the held units (no double
       deduction), marks the entry claimed.
     * get_batch_waitlist / skip_waitlist_entry (authenticated): seller-only,
       verified through batch ownership.
   - Public read added for sold-out batches (status='closed' AND
     closed_reason='sold_out', pickup date not passed) and their items and
     slots, so the storefront can show "Join the waitlist". Read-only.

5. Automation trigger
   - AFTER UPDATE on batch_items when units_available INCREASES (cancel
     restores units, seller adds units): runs the offer logic in the same
     transaction. Guarded so offer holds (which decrease units) don't
     re-trigger it.
*/

-- ============ table ============

CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  phone text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 1 AND quantity <= 4),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','claimed','expired')),
  claim_code text UNIQUE,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_batch ON waitlist(batch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_claim ON waitlist(claim_code);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- No policies: the table is fully sealed. All access goes through functions.
REVOKE ALL ON waitlist FROM anon, authenticated;

-- ============ core engine: expire stale offers, offer to next in line ============

CREATE OR REPLACE FUNCTION process_waitlist(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry waitlist%ROWTYPE;
  v_units integer;
  v_code text;
  v_i integer;
  v_j integer;
  v_batch_pickup date;
BEGIN
  SELECT pickup_date INTO v_batch_pickup FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  LOOP
    -- 1. Expire offers that ran out of time and release their held units
    FOR v_entry IN
      SELECT * FROM waitlist
      WHERE batch_id = p_batch_id AND status = 'offered' AND offer_expires_at <= now()
      FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE waitlist SET status = 'expired' WHERE id = v_entry.id;
      UPDATE batch_items
      SET units_available = units_available + v_entry.quantity
      WHERE batch_id = v_entry.batch_id AND product_id = v_entry.product_id;
    END LOOP;

    -- 2. Stop offering once the pickup date has passed
    IF v_batch_pickup < current_date THEN
      EXIT;
    END IF;

    -- 3. Oldest waiting entry whose product still has room (row-locked)
    SELECT w.* INTO v_entry
    FROM waitlist w
    JOIN batch_items bi ON bi.batch_id = w.batch_id AND bi.product_id = w.product_id
    WHERE w.batch_id = p_batch_id
      AND w.status = 'waiting'
      AND bi.units_available >= w.quantity
    ORDER BY w.created_at, w.id
    LIMIT 1
    FOR UPDATE OF w SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    -- 4. Hold the units and mark the entry offered for 30 minutes
    UPDATE batch_items
    SET units_available = units_available - v_entry.quantity
    WHERE batch_id = v_entry.batch_id AND product_id = v_entry.product_id;

    FOR v_i IN 1..5 LOOP
      v_code := '';
      FOR v_j IN 1..12 LOOP
        v_code := v_code || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', floor(random() * 31)::int + 1, 1);
      END LOOP;
      BEGIN
        UPDATE waitlist
        SET status = 'offered',
            claim_code = v_code,
            offered_at = now(),
            offer_expires_at = now() + interval '30 minutes'
        WHERE id = v_entry.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_i = 5 THEN
          -- could not mint a code: put the units back and stop
          UPDATE batch_items
          SET units_available = units_available + v_entry.quantity
          WHERE batch_id = v_entry.batch_id AND product_id = v_entry.product_id;
          EXIT;
        END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION process_waitlist(uuid) TO anon, authenticated;

-- ============ join (anonymous visitors, validated insert only) ============

CREATE OR REPLACE FUNCTION join_waitlist(
  p_batch_id uuid,
  p_product_id uuid,
  p_customer_name text,
  p_phone text,
  p_quantity integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;
  IF v_batch.pickup_date < current_date THEN
    RAISE EXCEPTION 'BATCH_ENDED';
  END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' OR length(btrim(p_customer_name)) > 80 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^[0-9+()\- ][0-9+()\- ]{6,19}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 4 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM batch_items WHERE batch_id = p_batch_id AND product_id = p_product_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_IN_BATCH';
  END IF;

  INSERT INTO waitlist (batch_id, product_id, customer_name, phone, quantity)
  VALUES (p_batch_id, p_product_id, btrim(p_customer_name), btrim(p_phone), p_quantity);

  -- If units happen to be free right now, the newcomer may be offered instantly
  PERFORM process_waitlist(p_batch_id);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION join_waitlist(uuid, uuid, text, text, integer) TO anon, authenticated;

-- ============ claim-page lookup (by code only) ============

CREATE OR REPLACE FUNCTION get_waitlist_offer(p_claim_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v waitlist%ROWTYPE;
  v_bi batch_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_batch batches%ROWTYPE;
  v_seller sellers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM waitlist WHERE claim_code = p_claim_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_bi FROM batch_items WHERE batch_id = v.batch_id AND product_id = v.product_id;
  SELECT * INTO v_product FROM products WHERE id = v.product_id;
  SELECT * INTO v_batch FROM batches WHERE id = v.batch_id;
  SELECT * INTO v_seller FROM sellers WHERE id = v_batch.seller_id;

  RETURN jsonb_build_object(
    'status', v.status,
    'expired', v.status = 'offered' AND v.offer_expires_at <= now(),
    'expires_at', v.offer_expires_at,
    'customer_name', v.customer_name,
    'phone', v.phone,
    'quantity', v.quantity,
    'product_name', v_product.name,
    'unit_price', v_product.price,
    'batch_id', v.batch.id,
    'batch_title', v_batch.title,
    'pickup_date', v_batch.pickup_date,
    'shop_name', v_seller.shop_name,
    'currency', v_seller.currency
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_waitlist_offer(text) TO anon, authenticated;

-- ============ claim: place the order from the held units ============

CREATE OR REPLACE FUNCTION claim_waitlist_order(
  p_claim_code text,
  p_customer_name text,
  p_phone text,
  p_pickup_slot_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v waitlist%ROWTYPE;
  v_batch batches%ROWTYPE;
  v_slot pickup_slots%ROWTYPE;
  v_slot_count integer := 0;
  v_unit_price numeric;
  v_total numeric;
  v_order_id uuid;
  v_code text;
  v_i integer;
  v_j integer;
  v_bi batch_items%ROWTYPE;
  v_all_zero boolean := true;
BEGIN
  SELECT * INTO v FROM waitlist WHERE claim_code = p_claim_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;
  IF v.status <> 'offered' OR v.offer_expires_at <= now() THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;

  SELECT * INTO v_batch FROM batches WHERE id = v.batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status <> 'open' THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;
  IF v_batch.pickup_date < current_date THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;

  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' OR length(btrim(p_customer_name)) > 80 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^[0-9+()\- ][0-9+()\- ]{6,19}$' THEN
    RAISE EXCEPTION 'INVALID_PHONE';
  END IF;

  IF p_pickup_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM pickup_slots
    WHERE id = p_pickup_slot_id AND batch_id = v.batch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLOT_NOT_FOUND';
    END IF;
    SELECT count(*) INTO v_slot_count FROM orders
    WHERE pickup_slot_id = p_pickup_slot_id AND status <> 'cancelled';
    IF v_slot_count >= v_slot.max_orders THEN
      RAISE EXCEPTION 'SLOT_FULL';
    END IF;
  END IF;

  -- The units are already held (deducted at offer time): just consume them.
  SELECT * INTO v_bi FROM batch_items
  WHERE batch_id = v.batch_id AND product_id = v.product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;

  SELECT price INTO v_unit_price FROM products WHERE id = v.product_id;
  IF v_unit_price IS NULL THEN
    RAISE EXCEPTION 'OFFER_INVALID';
  END IF;
  v_total := v_unit_price * v.quantity;

  INSERT INTO orders (batch_id, customer_name, phone, pickup_slot_id, status, total, payment_status, notes)
  VALUES (v.batch_id, btrim(p_customer_name), btrim(p_phone), p_pickup_slot_id, 'pending', v_total, 'unpaid', 'Waitlist claim')
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  VALUES (v_order_id, v.product_id, v.quantity, v_unit_price);

  UPDATE waitlist SET status = 'claimed' WHERE id = v.id;

  -- Sold-out check across the whole batch
  SELECT bool_and(bi.units_available = 0) INTO v_all_zero
  FROM batch_items bi WHERE bi.batch_id = v.batch_id;
  IF v_all_zero AND v_batch.capacity > 0 THEN
    UPDATE batches SET status = 'closed', closed_reason = 'sold_out' WHERE id = v.batch_id;
  END IF;

  FOR v_i IN 1..5 LOOP
    v_code := '';
    FOR v_j IN 1..10 LOOP
      v_code := v_code || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', floor(random() * 31)::int + 1, 1);
    END LOOP;
    BEGIN
      UPDATE orders SET code = v_code WHERE id = v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_i = 5 THEN
        RAISE EXCEPTION 'CODE_GENERATION_FAILED';
      END IF;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_waitlist_order(text, text, text, uuid) TO anon, authenticated;

-- ============ seller: view + skip ============

CREATE OR REPLACE FUNCTION get_batch_waitlist(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
BEGIN
  SELECT seller_id INTO v_seller FROM batches WHERE id = p_batch_id;
  IF v_seller IS NULL OR v_seller <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;

  PERFORM process_waitlist(p_batch_id);

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id,
      'customer_name', w.customer_name,
      'phone', w.phone,
      'quantity', w.quantity,
      'status', w.status,
      'claim_code', w.claim_code,
      'offer_expires_at', w.offer_expires_at,
      'created_at', w.created_at,
      'product_name', p.name
    ) ORDER BY w.created_at), '[]'::jsonb)
    FROM waitlist w
    JOIN products p ON p.id = w.product_id
    WHERE w.batch_id = p_batch_id AND w.status IN ('waiting', 'offered')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_batch_waitlist(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION skip_waitlist_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v waitlist%ROWTYPE;
  v_seller uuid;
BEGIN
  SELECT w.* INTO v FROM waitlist w
  JOIN batches b ON b.id = w.batch_id
  WHERE w.id = p_entry_id FOR UPDATE OF w;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND';
  END IF;
  SELECT seller_id INTO v_seller FROM batches WHERE id = v.batch_id;
  IF v_seller IS NULL OR v_seller <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;
  IF v.status NOT IN ('waiting', 'offered') THEN
    RETURN true;  -- nothing to skip
  END IF;

  IF v.status = 'offered' THEN
    UPDATE batch_items
    SET units_available = units_available + v.quantity
    WHERE batch_id = v.batch_id AND product_id = v.product_id;
  END IF;

  UPDATE waitlist SET status = 'expired' WHERE id = v.id;
  PERFORM process_waitlist(v.batch_id);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION skip_waitlist_entry(uuid) TO authenticated;

-- ============ automation: freed units are offered automatically ============

CREATE OR REPLACE FUNCTION waitlist_units_added_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.units_available > OLD.units_available THEN
    PERFORM process_waitlist(NEW.batch_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_waitlist_units_added ON batch_items;
CREATE TRIGGER trg_waitlist_units_added
AFTER UPDATE OF units_available ON batch_items
FOR EACH ROW EXECUTE FUNCTION waitlist_units_added_trigger();

-- ============ public read of sold-out batches (for the waitlist button) ============

DROP POLICY IF EXISTS "batches_public_read_sold_out" ON batches;
CREATE POLICY "batches_public_read_sold_out" ON batches FOR SELECT
  TO anon, authenticated USING (
    status = 'closed' AND closed_reason = 'sold_out' AND pickup_date >= current_date
  );

DROP POLICY IF EXISTS "batch_items_public_read_sold_out" ON batch_items;
CREATE POLICY "batch_items_public_read_sold_out" ON batch_items FOR SELECT
  TO anon, authenticated USING (
    EXISTS (
      SELECT 1 FROM batches
      WHERE batches.id = batch_items.batch_id
        AND batches.status = 'closed'
        AND batches.closed_reason = 'sold_out'
        AND batches.pickup_date >= current_date
    )
  );

DROP POLICY IF EXISTS "pickup_slots_public_read_sold_out" ON pickup_slots;
CREATE POLICY "pickup_slots_public_read_sold_out" ON pickup_slots FOR SELECT
  TO anon, authenticated USING (
    EXISTS (
      SELECT 1 FROM batches
      WHERE batches.id = pickup_slots.batch_id
        AND batches.status = 'closed'
        AND batches.closed_reason = 'sold_out'
        AND batches.pickup_date >= current_date
    )
  );
