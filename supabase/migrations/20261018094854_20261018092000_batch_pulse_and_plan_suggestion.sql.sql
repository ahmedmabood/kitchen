/*
# Batch Pulse: sell-out insights + next-batch planning (Feature 2)

1. Plain-English summary
   `get_batch_pulse(p_batch_id)` gives a seller the timeline of their batch:
   when it was created, when the first order arrived, when half the units
   were gone, and when it sold out (if it did), plus orders per hour (for a
   small chart) and sold-through percentage per product.
   `get_batch_plan_suggestion()` looks at the seller's last 3 batches and
   suggests a size for the next one: if recent batches sold out, suggest
   20% more units; if the last batch sold under 60%, suggest fewer. It also
   names the best-selling and slowest products. Pure rule-based SQL — no
   external AI service.

2. Security
   - Both are SECURITY DEFINER with locked search_path.
   - get_batch_pulse verifies the caller owns the batch (auth.uid()).
   - get_batch_plan_suggestion scopes every query to auth.uid().
   - Execute granted to authenticated only.
   - Cancelled orders never count toward the timeline or sell-through.

3. Notes
   - "Half sold" is the moment cumulative non-cancelled ordered units first
     reached ceil(capacity / 2).
   - orders_per_hour buckets orders by hour since batch creation (first 48
     hours) so the chart is stable regardless of when the batch was made.
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
      SELECT jsonb_agg(row.j) INTO v_per_hour
      FROM (
        SELECT jsonb_build_object(
          'hour', v_h,
          'orders', (
            SELECT count(*) FROM orders o
            WHERE o.batch_id = p_batch_id
              AND o.status <> 'cancelled'
              AND o.created_at >= v_batch.created_at + (v_h || ' hours')::interval
              AND o.created_at < v_batch.created_at + ((v_h + 1) || ' hours')::interval
          )
        ) AS j
        UNION ALL SELECT v_per_hour
        UNION ALL SELECT v_per_hour
        LIMIT 1
      ) row;
      -- simpler: rebuild array below (see append)
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

  -- Sold-through per product
  SELECT jsonb_agg(jsonb_build_object(
    'name', p.name,
    'sold', COALESCE(sold.qty, 0),
    'total', bi_total.units
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

CREATE OR REPLACE FUNCTION get_batch_plan_suggestion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_rec record;
  v_batches record;
  v_capacity integer;
  v_ordered integer;
  v_sold_out boolean;
  v_sell_through numeric;
  v_speed interval;
  v_all_sold_out boolean := true;
  v_any_low boolean := false;
  v_last_title text;
  v_last_speed text;
  v_last_sold_out boolean := false;
  v_last_sell_through numeric := 0;
  v_best text;
  v_slowest text;
  v_suggestion text;
  v_suggested_units integer;
  v_i integer := 0;
  v_first timestamptz;
  v_sold_out_at timestamptz;
  v_running integer;
  v_half_reached boolean;
  v_rec2 record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  -- Last 3 batches by creation (most recent first), counting only finished or open ones
  FOR v_rec IN
    SELECT b.id, b.title, b.capacity, b.pickup_date
    FROM batches b
    WHERE b.seller_id = v_uid
    ORDER BY b.created_at DESC
    LIMIT 3
  LOOP
    v_i := v_i + 1;
    v_capacity := v_rec.capacity;
    v_ordered := 0;
    v_first := NULL;
    v_sold_out_at := NULL;
    v_running := 0;

    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_ordered
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.batch_id = v_rec.id AND o.status <> 'cancelled';

    FOR v_rec2 IN
      SELECT o.created_at, SUM(oi.quantity) AS qty
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.batch_id = v_rec.id AND o.status <> 'cancelled'
      GROUP BY o.created_at, o.id
      ORDER BY o.created_at
    LOOP
      IF v_first IS NULL THEN v_first := v_rec2.created_at; END IF;
      v_running := v_running + v_rec2.qty;
      IF v_sold_out_at IS NULL AND v_capacity > 0 AND v_running >= v_capacity THEN
        v_sold_out_at := v_rec2.created_at;
      END IF;
    END LOOP;

    v_sold_out := v_capacity > 0 AND v_ordered >= v_capacity;
    v_sell_through := CASE WHEN v_capacity > 0 THEN round(100.0 * v_ordered / v_capacity) ELSE 0 END;
    v_speed := CASE WHEN v_sold_out AND v_first IS NOT NULL AND v_sold_out_at IS NOT NULL
                    THEN v_sold_out_at - v_first END;

    IF v_i = 1 THEN
      v_last_title := v_rec.title;
      v_last_sold_out := v_sold_out;
      v_last_sell_through := v_sell_through;
      v_last_speed := CASE
        WHEN v_speed IS NOT NULL THEN
          CASE
            WHEN extract(hours from v_speed) > 0
              THEN extract(hours from v_speed)::int || 'h ' || extract(minutes from v_speed)::int || 'm'
            ELSE extract(minutes from v_speed)::int || 'm'
          END
        ELSE NULL
      END;
    END IF;

    IF NOT v_sold_out THEN
      v_all_sold_out := false;
    END IF;
    IF v_sell_through < 60 THEN
      v_any_low := true;
    END IF;
  END LOOP;

  IF v_i = 0 THEN
    RETURN jsonb_build_object(
      'has_history', false,
      'message', 'Create and share a batch — after your first few, Batchly will suggest how big the next one should be.',
      'suggestion', NULL, 'suggested_units', NULL,
      'best_product', NULL, 'slowest_product', NULL,
      'last_batch_title', NULL, 'last_batch_speed', NULL, 'last_batch_sold_out', false
    );
  END IF;

  -- Need at least 2 batches with any orders for confident advice
  SELECT count(DISTINCT o.batch_id) INTO v_count
  FROM orders o JOIN batches b ON b.id = o.batch_id
  WHERE b.seller_id = v_uid AND o.status <> 'cancelled';

  -- Best and slowest products across the last 3 batches (by units sold vs offered)
  SELECT p.name INTO v_best
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN batches b ON b.id = o.batch_id
  JOIN products p ON p.id = oi.product_id
  WHERE b.seller_id = v_uid AND o.status <> 'cancelled'
    AND b.id IN (SELECT id FROM batches WHERE seller_id = v_uid ORDER BY created_at DESC LIMIT 3)
  GROUP BY p.name
  ORDER BY SUM(oi.quantity) DESC
  LIMIT 1;

  SELECT p.name INTO v_slowest
  FROM batches b
  JOIN batch_items bi ON bi.batch_id = b.id
  JOIN products p ON p.id = bi.product_id
  LEFT JOIN (
    SELECT oi.product_id, SUM(oi.quantity) AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN batches b2 ON b2.id = o.batch_id
    WHERE o.status <> 'cancelled'
      AND b2.id IN (SELECT id FROM batches WHERE seller_id = v_uid ORDER BY created_at DESC LIMIT 3)
    GROUP BY oi.product_id
  ) sold ON sold.product_id = bi.product_id
  WHERE b.seller_id = v_uid
    AND b.id IN (SELECT id FROM batches WHERE seller_id = v_uid ORDER BY created_at DESC LIMIT 3)
  GROUP BY p.name, COALESCE(sold.qty, 0)
  HAVING COALESCE(sold.qty, 0) <= (SELECT COALESCE(SUM(oi.quantity), 0) / 3
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN batches b3 ON b3.id = o.batch_id
    WHERE b3.seller_id = v_uid AND o.status <> 'cancelled'
      AND b3.id IN (SELECT id FROM batches WHERE seller_id = v_uid ORDER BY created_at DESC LIMIT 3)
  )
  ORDER BY COALESCE(sold.qty, 0) ASC
  LIMIT 1;

  -- Suggestion logic
  v_suggested_units := NULL;
  IF v_all_sold_out THEN
    v_suggested_units := ceil(v_last_sell_through * 0 + COALESCE((
      SELECT b.capacity FROM batches b WHERE b.seller_id = v_uid ORDER BY b.created_at DESC LIMIT 1
    ), 0) * 1.2)::int;
    v_suggestion := 'Your last batches sold out' ||
      CASE WHEN v_last_speed IS NOT NULL THEN ' — the latest in ' || v_last_speed ELSE '' END ||
      '. Try about ' || v_suggested_units || ' units next time so fewer people miss out.';
  ELSIF v_last_sell_through < 60 THEN
    v_suggested_units := greatest(1, ceil(COALESCE((
      SELECT b.capacity FROM batches b WHERE b.seller_id = v_uid ORDER BY b.created_at DESC LIMIT 1
    ), 0) * 0.7)::int);
    v_suggestion := 'Your last batch only sold ' || v_last_sell_through || '%. Try about ' || v_suggested_units || ' units next time.';
  ELSE
    v_suggestion := 'Your last batch sold ' || v_last_sell_through || '% — that''s a healthy pace. Keep a similar size.';
  END IF;

  RETURN jsonb_build_object(
    'has_history', v_count >= 1,
    'message', v_suggestion,
    'suggestion', v_suggestion,
    'suggested_units', v_suggested_units,
    'best_product', v_best,
    'slowest_product', v_slowest,
    'last_batch_title', v_last_title,
    'last_batch_speed', v_last_speed,
    'last_batch_sold_out', v_last_sold_out
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_batch_plan_suggestion() TO authenticated;
