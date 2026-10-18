import { supabase } from "@/lib/supabase"

export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired"

export type WaitlistOffer = {
  status: WaitlistStatus | "invalid"
  expired: boolean
  expires_at: string | null
  customer_name: string | null
  phone: string | null
  quantity: number | null
  product_name: string | null
  unit_price: number | null
  batch_id: string | null
  batch_title: string | null
  pickup_date: string | null
  shop_name: string | null
  currency: string | null
}

export async function getWaitlistOffer(code: string): Promise<WaitlistOffer | null> {
  const { data, error } = await supabase.rpc("get_waitlist_offer", { p_claim_code: code })
  if (error) return null
  return (data as WaitlistOffer | null) ?? null
}

export async function claimWaitlistOrder(input: {
  code: string
  customerName: string
  phone: string
  pickupSlotId: string | null
}): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("claim_waitlist_order", {
    p_claim_code: input.code,
    p_customer_name: input.customerName,
    p_phone: input.phone,
    p_pickup_slot_id: input.pickupSlotId,
  })
  if (!error) return { ok: true, code: data as string }
  const msg = error.message
  if (msg.includes("OFFER_INVALID")) return { ok: false, error: "offer_invalid" }
  if (msg.includes("SLOT_FULL") || msg.includes("SLOT_NOT_FOUND")) return { ok: false, error: "slot" }
  if (msg.includes("INVALID_NAME") || msg.includes("INVALID_PHONE")) return { ok: false, error: "input" }
  return { ok: false, error: "unknown" }
}

export type WaitlistEntry = {
  id: string
  customer_name: string
  phone: string
  quantity: number
  status: "waiting" | "offered"
  claim_code: string | null
  offer_expires_at: string | null
  created_at: string
  product_name: string
}

export async function getBatchWaitlist(batchId: string): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase.rpc("get_batch_waitlist", { p_batch_id: batchId })
  if (error) return []
  return (data as WaitlistEntry[]) ?? []
}

export async function skipWaitlistEntry(entryId: string): Promise<boolean> {
  const { error } = await supabase.rpc("skip_waitlist_entry", { p_entry_id: entryId })
  return !error
}

export async function joinWaitlist(input: {
  batchId: string
  productId: string
  customerName: string
  phone: string
  quantity: number
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("join_waitlist", {
    p_batch_id: input.batchId,
    p_product_id: input.productId,
    p_customer_name: input.customerName,
    p_phone: input.phone,
    p_quantity: input.quantity,
  })
  if (!error) return { ok: true }
  const msg = error.message
  if (msg.includes("INVALID_PHONE")) return { ok: false, error: "phone" }
  if (msg.includes("INVALID_NAME")) return { ok: false, error: "name" }
  if (msg.includes("INVALID_QUANTITY")) return { ok: false, error: "quantity" }
  if (msg.includes("BATCH_ENDED") || msg.includes("BATCH_NOT_FOUND")) return { ok: false, error: "ended" }
  return { ok: false, error: "unknown" }
}

export async function processWaitlist(batchId: string): Promise<void> {
  await supabase.rpc("process_waitlist", { p_batch_id: batchId })
}

export type BatchPulseStats = {
  created_at: string | null
  first_order_at: string | null
  half_sold_at: string | null
  sold_out_at: string | null
  orders_per_hour: { hour: string; orders: number }[] | null
  product_sell_through: { name: string; sold: number; total: number }[] | null
}

export async function getBatchPulse(batchId: string): Promise<BatchPulseStats | null> {
  const { data, error } = await supabase.rpc("get_batch_pulse", { p_batch_id: batchId })
  if (error) return null
  return (data as BatchPulseStats | null) ?? null
}

export type PlanSuggestion = {
  has_history: boolean
  message: string
  suggestion: string | null
  suggested_units: number | null
  best_product: string | null
  slowest_product: string | null
  last_batch_title: string | null
  last_batch_speed: string | null
  last_batch_sold_out: boolean
}

export async function getBatchPlanSuggestion(): Promise<PlanSuggestion | null> {
  const { data, error } = await supabase.rpc("get_batch_plan_suggestion")
  if (error) return null
  return (data as PlanSuggestion | null) ?? null
}
