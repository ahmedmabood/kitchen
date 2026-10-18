/*
# Include seller WhatsApp number in order lookup

1. Plain-English summary
   The order confirmation page now shows a "Message the seller on
   WhatsApp" button when the seller has saved a WhatsApp number. This
   migration adds that number to the data already returned by the
   code-based order lookup function. No other behavior changes.

2. Modified function: `get_order_by_code`
   The returned JSON now includes `seller_whatsapp` (the seller's
   WhatsApp number as stored, or null).
*/

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
    'seller_whatsapp', s.whatsapp_number,
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
