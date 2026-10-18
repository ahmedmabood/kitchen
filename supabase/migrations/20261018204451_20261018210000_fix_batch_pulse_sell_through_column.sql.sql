/*
# Fix Batch Pulse product sell-through query

1. Problem
   `get_batch_pulse` read a `batch_items.units` column that does not exist
   (the real column is `units_available`), so every call failed with
   "column bi_total.units does not exist" and the Batch Pulse card could
   not load on the seller Orders page.

2. Fix
   In the per-product sell-through query, replace `bi_total.units` with
   `COALESCE(sold.qty, 0) + bi_total.units_available`: the total units
   offered per product is the units sold so far plus the units still
   available (held waitlist units are already deducted from available).
   Intent of the original query — sold-through per product — unchanged.

3. Security
   No privilege changes. Function stays SECURITY DEFINER with locked
   search_path; execute stays granted to authenticated only.
*/

CREATE OR REPLACE FUNCTION get_batch_pulse(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
  v_batch batches%ROWTYPE;
  v_total_capacity integer;
  v_ordered integer;
  v_first timestamptz;
  v_half timestamptz;
  v_sold_out timestamptz;
  v_running integer;
  v_rec record;
  v_hours integer;
  v_h integer;
  v_per_hour jsonb;
  v_per_product jsonb;
BEGIN
  SELECT seller_id INTO v_seller FROM batches WHERE id = p_batch_id;
  IF v_seller IS NULL OR v_seller <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_YOUR_BATCH';
  END IF;

  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id;
  v_total_capacity := v_batch.capacity;

  -- Cumulative ordered units over time (non-cancelled)
  v_running := 0;
  v_first := NULL;
  v_half := NULL;
  v_sold_out := NULL;

  FOR v_rec IN
    SELECT o.created_at, SUM(oi.quantity) AS qty
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.batch_id = p_batch_id AND o.status <> 'cancelled'
    GROUP BY o.created_at, o.id
    ORDER BY o.created_at
  LOOP
    IF v_first IS NULL THEN
      v_first := v_rec.created_at;
    END IF;
    v_running := v_running + v_rec.qty;
    IF v_half IS NULL AND v_total_capacity > 0 AND v_running >= ceil(v_total_capacity / 2.0) THEN
      v_half := v_rec.created_at;
    END IF;
    IF v_sold_out IS NULL AND v_total_capacity > 0 AND v_running >= v_total_capacity THEN
      v_sold_out := v_rec.created_at;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(oi.quantity), 0) INTO v_ordered
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.batch_id = p_batch_id AND o.status <> 'cancelled';

  -- Orders per hour: buckets of 1h from batch creation, up to 48 buckets
  v_per_hour := '[]'::jsonb;
  IF v_first IS NOT NULL AND v_total_capacity > 0 THEN
    v_hours := least(48, greatest(1, ceil(extract(epoch FROM (now() - v_batch.created_at)) / 3600)::int));
    FOR v_h IN 0..v_hours - 1 LOOP
      v_per_hour := v_per_hour || jsonb_build_array(jsonb_build_object(
        'hour', v_h,
        'orders', (
          SELECT count(*) FROM orders o
          WHERE o.batch_id = p_batch_id
            AND o.status <> 'cancelled'
            AND o.created_at >= v_batch.created_at + (v_h || ' hours')::interval
            AND o.created_at < v_batch.created_at + ((v_h + 1) || ' hours')::interval
        )
      ));
    END LOOP;
  END IF;

  -- Sold-through per product: total offered = units sold + units still available
  SELECT jsonb_agg(jsonb_build_object(
    'name', p.name,
    'sold', COALESCE(sold.qty, 0),
    'total', COALESCE(sold.qty, 0) + bi_total.units_available
  ) ORDER BY p.name)
  INTO v_per_product
  FROM batch_items bi_total
  JOIN products p ON p.id = bi_total.product_id
  LEFT JOIN (
    SELECT oi.product_id, SUM(oi.quantity) AS qty
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.batch_id = p_batch_id AND o.status <> 'cancelled'
    GROUP BY oi.product_id
  ) sold ON sold.product_id = bi_total.product_id
  WHERE bi_total.batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'created_at', v_batch.created_at,
    'first_order_at', v_first,
    'half_sold_at', v_half,
    'sold_out_at', v_sold_out,
    'orders_per_hour', CASE WHEN v_first IS NULL THEN NULL ELSE v_per_hour END,
    'product_sell_through', v_per_product,
    'capacity', v_total_capacity,
    'ordered', v_ordered
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_batch_pulse(uuid) TO authenticated;