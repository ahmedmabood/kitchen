import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Seller = {
  id: string
  shop_name: string
  slug: string
  bio: string | null
  logo_url: string | null
  currency: string
  pickup_address: string | null
  whatsapp_number: string | null
  demo_locked?: boolean
  created_at: string
  updated_at: string
}

export type Product = {
  id: string
  seller_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type Batch = {
  id: string
  seller_id: string
  title: string
  pickup_date: string
  capacity: number
  status: "open" | "closed"
  created_at: string
  updated_at: string
}

export type BatchItem = {
  id: string
  batch_id: string
  product_id: string
  units_available: number
}

export type PickupSlot = {
  id: string
  batch_id: string
  start_time: string
  end_time: string
  max_orders: number
}

export type Order = {
  id: string
  batch_id: string
  customer_name: string
  phone: string
  pickup_slot_id: string | null
  status: "pending" | "confirmed" | "fulfilled" | "cancelled"
  total: number
  payment_status: "unpaid" | "paid"
  notes: string | null
  created_at: string
}

export type StorefrontBatch = Batch & {
  items: (BatchItem & { product: Product })[]
  slots: PickupSlot[]
}
