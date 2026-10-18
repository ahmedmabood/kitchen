import { supabase } from "@/lib/supabase"

export type OrderItemLine = {
  name: string
  quantity: number
  unit_price: number
}

export type OrderDetails = {
  code: string
  customer_name: string
  status: string
  total: number
  payment_status: string
  notes: string | null
  created_at: string
  shop_name: string
  shop_slug: string
  currency: string
  pickup_address: string | null
  seller_whatsapp: string | null
  batch_title: string
  pickup_date: string
  pickup_start: string | null
  pickup_end: string | null
  items: OrderItemLine[] | null
}

export async function placeOrder(input: {
  batchId: string
  customerName: string
  phone: string
  pickupSlotId: string | null
  notes: string | null
  items: { product_id: string; quantity: number }[]
}): Promise<{ ok: true; code: string } | { ok: false; kind: OrderErrorKind; message?: string }> {
  const { data, error } = await supabase.rpc("place_order", {
    p_batch_id: input.batchId,
    p_customer_name: input.customerName,
    p_phone: input.phone,
    p_pickup_slot_id: input.pickupSlotId,
    p_notes: input.notes,
    p_items: input.items,
  })
  if (!error) return { ok: true, code: data as string }
  return { ok: false, kind: classifyOrderError(error.message) }
}

export type OrderErrorKind =
  | "sold_out"
  | "batch_closed"
  | "slot_full"
  | "invalid_input"
  | "unknown"

function classifyOrderError(raw: string): OrderErrorKind {
  const msg = raw.replace(/^.*?(?=Exception: )/, "").replace("Exception: ", "").trim()
  if (msg.includes("INSUFFICIENT_UNITS") || msg.includes("PRODUCT_NOT_IN_BATCH") || msg.includes("PRODUCT_NOT_FOUND"))
    return "sold_out"
  if (msg.includes("BATCH_CLOSED") || msg.includes("BATCH_NOT_FOUND")) return "batch_closed"
  if (msg.includes("SLOT_FULL") || msg.includes("SLOT_NOT_FOUND")) return "slot_full"
  if (msg.includes("INVALID_NAME") || msg.includes("INVALID_PHONE") || msg.includes("INVALID_QUANTITY") || msg.includes("EMPTY_ORDER"))
    return "invalid_input"
  return "unknown"
}

export async function getOrderByCode(code: string): Promise<OrderDetails | null> {
  const { data, error } = await supabase.rpc("get_order_by_code", { p_code: code })
  if (error) return null
  return (data as OrderDetails | null) ?? null
}

export type SlotUsage = { slot_id: string; remaining: number }

export async function getSlotUsage(batchId: string): Promise<SlotUsage[]> {
  const { data, error } = await supabase.rpc("get_slot_usage", { p_batch_id: batchId })
  if (error) return []
  return (data as SlotUsage[]) ?? []
}

export type SellerOrder = {
  id: string
  batch_id: string
  code: string
  customer_name: string
  phone: string
  pickup_slot_id: string | null
  status: "pending" | "confirmed" | "fulfilled" | "cancelled"
  total: number
  payment_status: "unpaid" | "paid"
  notes: string | null
  created_at: string
  items: { product_id: string; name: string; quantity: number; unit_price: number }[]
  slot_start: string | null
  slot_end: string | null
}

export async function getSellerOrders(batchId: string): Promise<SellerOrder[]> {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, items:order_items(*, product:products(id, name))")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true })
  if (error || !orders) return []
  const { data: slots } = await supabase
    .from("pickup_slots")
    .select("id, start_time, end_time")
    .eq("batch_id", batchId)
  const slotById = new Map((slots ?? []).map((s) => [s.id, s]))
  return orders.map((o) => ({
    id: o.id,
    batch_id: o.batch_id,
    code: o.code,
    customer_name: o.customer_name,
    phone: o.phone,
    pickup_slot_id: o.pickup_slot_id,
    status: o.status,
    total: Number(o.total),
    payment_status: o.payment_status,
    notes: o.notes,
    created_at: o.created_at,
    items: (o.items ?? []).map((i: any) => ({
      product_id: i.product_id,
      name: i.product?.name ?? "Unknown product",
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
    })),
    slot_start: o.pickup_slot_id ? (slotById.get(o.pickup_slot_id)?.start_time ?? null) : null,
    slot_end: o.pickup_slot_id ? (slotById.get(o.pickup_slot_id)?.end_time ?? null) : null,
  }))
}

export async function cancelOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId })
  if (!error) return { ok: true }
  const msg = error.message
  if (msg.includes("ALREADY_FULFILLED")) return { ok: false, error: "already_fulfilled" }
  if (msg.includes("ALREADY_CANCELLED")) return { ok: false, error: "already_cancelled" }
  return { ok: false, error: "unknown" }
}

export async function setOrderStatus(orderId: string, status: "pending" | "confirmed" | "fulfilled") {
  const { error } = await supabase.rpc("update_order_status", { p_order_id: orderId, p_status: status })
  return !error
}

export async function setOrderPaid(orderId: string, paid: boolean) {
  const { error } = await supabase.rpc("update_order_payment", { p_order_id: orderId, p_paid: paid })
  return !error
}

export async function resetDemoData(): Promise<boolean> {
  const { data, error } = await supabase.rpc("reset_demo_data")
  return !error && data === true
}

export async function reopenBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("reopen_batch", { p_batch_id: batchId })
  if (!error) return { ok: true }
  const msg = error.message
  if (msg.includes("PICKUP_DATE_PASSED")) return { ok: false, error: "pickup_date_passed" }
  if (msg.includes("NO_UNITS_LEFT")) return { ok: false, error: "no_units_left" }
  return { ok: false, error: "unknown" }
}

export async function duplicateBatch(
  batchId: string,
  newDate: string,
  units?: Record<string, number>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("duplicate_batch", {
    p_batch_id: batchId,
    p_new_date: newDate,
    p_units: units ?? null,
  })
  if (!error) return { ok: true }
  const msg = error.message
  if (msg.includes("INVALID_DATE")) return { ok: false, error: "invalid_date" }
  if (msg.includes("INVALID_UNITS")) return { ok: false, error: "invalid_units" }
  return { ok: false, error: "unknown" }
}

export function normalizeWaNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  return digits.length >= 8 ? digits : null
}

export function waLink(phone: string | null | undefined, message: string): string | null {
  const n = normalizeWaNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null
}
