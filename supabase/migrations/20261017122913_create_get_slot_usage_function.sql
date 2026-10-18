/*
# Public pickup-slot room availability

1. Plain-English summary
   The order review screen needs to show which pickup time slots still have
   room ("X spots left") and which are full, without exposing anyone's
   order data. This migration adds a small read-only function that returns,
   for one batch, how many spots remain in each slot. It never exposes
   customer names, phones, or order details — only a count.

2. New function: `get_slot_usage` (SECURITY DEFINER)
   Input: p_batch_id (uuid). Output: JSON array of {slot_id, remaining}
   for every slot in that batch, where remaining = max_orders minus the
   number of non-cancelled orders in that slot. Execute granted to anon
   and authenticated so logged-out customers can see it on the storefront.

3. Notes
   - Orders themselves remain completely private; this leaks no rows,
     only an integer per slot, which the storefront already displays
     in spirit via "units left".
*/

CREATE OR REPLACE FUNCTION get_slot_usage(p_batch_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_agg(jsonb_build_object('slot_id', ps.id, 'remaining', ps.max_orders - coalesce(u.cnt, 0)) ORDER BY ps.start_time),
    '[]'::jsonb
  )
  FROM pickup_slots ps
  LEFT JOIN (
    SELECT pickup_slot_id, count(*) AS cnt
    FROM orders
    WHERE status <> 'cancelled' AND pickup_slot_id IS NOT NULL
    GROUP BY pickup_slot_id
  ) u ON u.pickup_slot_id = ps.id
  WHERE ps.batch_id = p_batch_id;
$$;

GRANT EXECUTE ON FUNCTION get_slot_usage(uuid) TO anon, authenticated;
