/*
# Tighten function and table privileges

1. Plain-English summary
   - Seller-only functions (cancel_order, update_order_status,
     update_order_payment, reopen_batch, duplicate_batch) are no longer
     callable by logged-out visitors. Only signed-in sellers can run them;
     each still verifies ownership inside the function.
   - Public functions stay public by design: place_order (customers order
     without an account), get_order_by_code (confirmation page), and
     get_slot_usage (slot availability counts).
   - Removes TRUNCATE, REFERENCES and TRIGGER table privileges from client
     roles on all tables. TRUNCATE bypasses row-level security, so no
     client role should ever have it.

2. Security
   - Pure privilege tightening; no data or policy changes.
   - Idempotent: revokes are safe to re-run.
*/

REVOKE EXECUTE ON FUNCTION cancel_order(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_order_status(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_order_payment(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION reopen_batch(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION duplicate_batch(uuid, date) FROM anon, PUBLIC;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON sellers, products, batches, batch_items, pickup_slots, orders, order_items FROM anon, authenticated;
