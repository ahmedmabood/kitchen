/*
# Batchly: core schema (sellers, products, batches, orders) + storage

1. Plain-English summary
   Batchly is a pre-order storefront for home food sellers. Sellers sign up,
   create a shop profile, list products, and run limited "batches" (a fixed
   number of units of selected products with a pickup date and pickup time
   slots). Customers browse a public storefront and (in a later step) place
   orders. This migration creates all core tables, locks them down with
   row-level security, and adds a public storage bucket for product photos
   and shop logos.

2. New Tables
   - `sellers`        one row per seller account. id = auth user id. Holds shop
                      name, unique public slug (used in /s/[slug]), bio, logo
                      URL, currency code, pickup address text, and timestamps.
   - `products`       a seller's menu items: name, description, price, image
                      URL, and an `active` flag for hide/show. Owned by seller.
   - `batches`        a pre-order drop: title, pickup date, capacity (computed
                      as the sum of units across its items), and status
                      ('open' | 'closed'). 'sold_out' is derived: a closed batch
                      whose items are all at 0 is displayed as "Sold out".
   - `batch_items`    links a product to a batch with `units_available`. The
                      live units left is derived by subtracting ordered
                      quantity from units_available (orders in later step).
   - `pickup_slots`   time windows (start/end) per batch with `max_orders`.
   - `orders`         a customer pre-order: batch, customer name, phone,
                      pickup slot, status ('pending'|'confirmed'|'fulfilled'|
                      'cancelled'), total, payment_status ('unpaid'|'paid'),
                      and free-text notes.
   - `order_items`    line items: order, product, quantity, unit price.

3. Security (row level security)
   - Every table has RLS enabled.
   - Seller-owned tables (sellers, products, batches) use owner-scoped
     policies: authenticated sellers can SELECT/INSERT/UPDATE/DELETE only
     their own rows (auth.uid() checks).
   - Child tables (batch_items, pickup_slots) are managed only by the owning
     seller, checked through the parent batch.
   - Public storefront reads (anon + authenticated) are allowed on:
       sellers (full profile — it is public by design),
       products where active = true,
       batches where status = 'open',
       batch_items / pickup_slots belonging to open batches.
     These are read-only. Orders are NOT publicly readable or writable in
     this step; the seller sees all their own orders.
   - The `sellers.id` defaults to auth.uid() so inserts never need to pass it.
   - The slug is unique per seller shop; a check constraint validates format
     (lowercase letters, numbers, hyphens, 2-40 chars).

4. Storage
   - New public bucket `batchly-media` for product photos and shop logos.
   - Anyone can read files (public storefront needs images); only the owning
     authenticated seller can upload into a path named with their own user id,
     update or delete their own files.

5. Notes
   - No destructive operations; all statements are idempotent-safe for the
     initial creation.
   - Total capacity of a batch is computed as SUM(batch_items.units_available);
     the app keeps `batches.capacity` updated in the same transaction-free
     flow (insert items, then set capacity).
*/

-- ============ Tables ============

CREATE TABLE IF NOT EXISTS sellers (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  bio text,
  logo_url text,
  currency text NOT NULL DEFAULT 'USD',
  pickup_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sellers_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  CONSTRAINT sellers_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL DEFAULT auth.uid() REFERENCES sellers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  image_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL DEFAULT auth.uid() REFERENCES sellers(id) ON DELETE CASCADE,
  title text NOT NULL,
  pickup_date date NOT NULL,
  capacity integer NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  units_available integer NOT NULL CHECK (units_available >= 0),
  UNIQUE (batch_id, product_id)
);

CREATE TABLE IF NOT EXISTS pickup_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  max_orders integer NOT NULL CHECK (max_orders >= 1),
  CONSTRAINT pickup_slots_time_order CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  phone text NOT NULL,
  pickup_slot_id uuid REFERENCES pickup_slots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','fulfilled','cancelled')),
  total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity >= 1),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_batches_seller ON batches(seller_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_pickup_slots_batch ON pickup_slots(batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ============ Row Level Security ============

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- sellers: owner manages own row; public can read profiles for storefronts
DROP POLICY IF EXISTS "sellers_select_own" ON sellers;
CREATE POLICY "sellers_select_own" ON sellers FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "sellers_insert_own" ON sellers;
CREATE POLICY "sellers_insert_own" ON sellers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "sellers_update_own" ON sellers;
CREATE POLICY "sellers_update_own" ON sellers FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "sellers_delete_own" ON sellers;
CREATE POLICY "sellers_delete_own" ON sellers FOR DELETE
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "sellers_public_read" ON sellers;
CREATE POLICY "sellers_public_read" ON sellers FOR SELECT
  TO anon, authenticated USING (true);

-- products: owner manages; public reads active products only
DROP POLICY IF EXISTS "products_select_own" ON products;
CREATE POLICY "products_select_own" ON products FOR SELECT
  TO authenticated USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "products_insert_own" ON products;
CREATE POLICY "products_insert_own" ON products FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "products_update_own" ON products;
CREATE POLICY "products_update_own" ON products FOR UPDATE
  TO authenticated USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "products_delete_own" ON products;
CREATE POLICY "products_delete_own" ON products FOR DELETE
  TO authenticated USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "products_public_read_active" ON products;
CREATE POLICY "products_public_read_active" ON products FOR SELECT
  TO anon, authenticated USING (active = true);

-- batches: owner manages; public reads open batches
DROP POLICY IF EXISTS "batches_select_own" ON batches;
CREATE POLICY "batches_select_own" ON batches FOR SELECT
  TO authenticated USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "batches_insert_own" ON batches;
CREATE POLICY "batches_insert_own" ON batches FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "batches_update_own" ON batches;
CREATE POLICY "batches_update_own" ON batches FOR UPDATE
  TO authenticated USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "batches_delete_own" ON batches;
CREATE POLICY "batches_delete_own" ON batches FOR DELETE
  TO authenticated USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "batches_public_read_open" ON batches;
CREATE POLICY "batches_public_read_open" ON batches FOR SELECT
  TO anon, authenticated USING (status = 'open');

-- batch_items: owner manages through parent batch; public reads open batches' items
DROP POLICY IF EXISTS "batch_items_select_own" ON batch_items;
CREATE POLICY "batch_items_select_own" ON batch_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "batch_items_insert_own" ON batch_items;
CREATE POLICY "batch_items_insert_own" ON batch_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "batch_items_update_own" ON batch_items;
CREATE POLICY "batch_items_update_own" ON batch_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.seller_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "batch_items_delete_own" ON batch_items;
CREATE POLICY "batch_items_delete_own" ON batch_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "batch_items_public_read_open" ON batch_items;
CREATE POLICY "batch_items_public_read_open" ON batch_items FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = batch_items.batch_id AND batches.status = 'open')
  );

-- pickup_slots: same pattern as batch_items
DROP POLICY IF EXISTS "pickup_slots_select_own" ON pickup_slots;
CREATE POLICY "pickup_slots_select_own" ON pickup_slots FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "pickup_slots_insert_own" ON pickup_slots;
CREATE POLICY "pickup_slots_insert_own" ON pickup_slots FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "pickup_slots_update_own" ON pickup_slots;
CREATE POLICY "pickup_slots_update_own" ON pickup_slots FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.seller_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "pickup_slots_delete_own" ON pickup_slots;
CREATE POLICY "pickup_slots_delete_own" ON pickup_slots FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "pickup_slots_public_read_open" ON pickup_slots;
CREATE POLICY "pickup_slots_public_read_open" ON pickup_slots FOR SELECT
  TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = pickup_slots.batch_id AND batches.status = 'open')
  );

-- orders: only the owning seller (through batch) can manage; no public access this step
DROP POLICY IF EXISTS "orders_select_own" ON orders;
CREATE POLICY "orders_select_own" ON orders FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = orders.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "orders_insert_own" ON orders;
CREATE POLICY "orders_insert_own" ON orders FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = orders.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "orders_update_own" ON orders;
CREATE POLICY "orders_update_own" ON orders FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = orders.batch_id AND batches.seller_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = orders.batch_id AND batches.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "orders_delete_own" ON orders;
CREATE POLICY "orders_delete_own" ON orders FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batches WHERE batches.id = orders.batch_id AND batches.seller_id = auth.uid())
  );

-- order_items: seller manages through order -> batch
DROP POLICY IF EXISTS "order_items_select_own" ON order_items;
CREATE POLICY "order_items_select_own" ON order_items FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders
      JOIN batches ON batches.id = orders.batch_id
      WHERE orders.id = order_items.order_id AND batches.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "order_items_insert_own" ON order_items;
CREATE POLICY "order_items_insert_own" ON order_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      JOIN batches ON batches.id = orders.batch_id
      WHERE orders.id = order_items.order_id AND batches.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "order_items_update_own" ON order_items;
CREATE POLICY "order_items_update_own" ON order_items FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders
      JOIN batches ON batches.id = orders.batch_id
      WHERE orders.id = order_items.order_id AND batches.seller_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      JOIN batches ON batches.id = orders.batch_id
      WHERE orders.id = order_items.order_id AND batches.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "order_items_delete_own" ON order_items;
CREATE POLICY "order_items_delete_own" ON order_items FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders
      JOIN batches ON batches.id = orders.batch_id
      WHERE orders.id = order_items.order_id AND batches.seller_id = auth.uid()
    )
  );

-- ============ Storage ============

INSERT INTO storage.buckets (id, name, public)
VALUES ('batchly-media', 'batchly-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "batchly_media_public_read" ON storage.objects;
CREATE POLICY "batchly_media_public_read" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'batchly-media');

DROP POLICY IF EXISTS "batchly_media_owner_insert" ON storage.objects;
CREATE POLICY "batchly_media_owner_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'batchly-media' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "batchly_media_owner_update" ON storage.objects;
CREATE POLICY "batchly_media_owner_update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'batchly-media' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "batchly_media_owner_delete" ON storage.objects;
CREATE POLICY "batchly_media_owner_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'batchly-media' AND auth.uid()::text = (storage.foldername(name))[1]);
