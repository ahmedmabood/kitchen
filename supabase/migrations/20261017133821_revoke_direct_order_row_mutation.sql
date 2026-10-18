/*
# Lock down direct row access to orders and order_items

1. Plain-English summary
   Sellers must manage orders only through the secure database functions
   (cancel_order, update_order_status, update_order_payment), which verify
   ownership, refuse fulfilled orders, and return units to the batch when an
   order is cancelled. A leftover table-level DELETE grant on `orders` (and
   UPDATE/DELETE grants on `order_items`) would have let a signed-in seller
   delete order rows directly from the browser, bypassing the unit-return
   logic. This migration removes those client-facing privileges.

2. Modified tables
   - `orders`: REVOKE DELETE from anon and authenticated. Row reads remain
     governed by RLS (sellers see their own orders; visitors only through
     get_order_by_code).
   - `order_items`: REVOKE UPDATE and DELETE from anon and authenticated.
     Rows are created only by place_order and read via RLS joins or
     get_order_by_code.

3. Security changes
   - No new policies; pure privilege tightening (least privilege).
   - RLS remains enabled on both tables (unchanged).
   - Service-role / owner (used by the secure functions) is unaffected.

4. Important notes
   - Idempotent: revokes are safe to re-run.
   - No data is modified or removed.
*/

REVOKE DELETE ON orders FROM anon, authenticated;
REVOKE UPDATE, DELETE ON order_items FROM anon, authenticated;
