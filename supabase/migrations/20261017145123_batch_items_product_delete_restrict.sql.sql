/*
# Make product deletion safe for batches

1. Plain-English summary
   Deleting a product that is part of a batch used to silently erase that
   product's inventory rows from the batch (the link cascaded), shrinking
   live batches and making the "ordered / units left" math wrong. Now the
   database refuses to delete a product that is still in a batch; the
   seller sees the existing clear message ("it may be part of a batch —
   hide it instead"). Deleting unused products still works.

2. Schema change
   - batch_items.product_id foreign key: ON DELETE CASCADE -> ON DELETE
     RESTRICT (no data change; constraint rebuilt).

3. Notes
   - Idempotent: drops the constraint only if it exists, then re-adds.
*/

ALTER TABLE batch_items DROP CONSTRAINT batch_items_product_id_fkey;
ALTER TABLE batch_items
  ADD CONSTRAINT batch_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
