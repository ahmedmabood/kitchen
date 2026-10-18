import * as React from "react"
import { ClipboardList, Printer, Loader2, MessageCircle, PackageCheck, Utensils, X, Wallet, Receipt, Hourglass, SkipForward, Activity, Sparkles, TrendingUp, FileDown } from "lucide-react"
import { toast } from "sonner"
import { jsPDF } from "jspdf"
import { useAuth } from "@/lib/auth"
import { supabase, type Batch } from "@/lib/supabase"
import {
  getSellerOrders,
  cancelOrder,
  setOrderStatus,
  setOrderPaid,
  waLink,
  type SellerOrder,
} from "@/lib/orders"
import {
  getBatchWaitlist,
  skipWaitlistEntry,
  getBatchPulse,
  getBatchPlanSuggestion,
  type WaitlistEntry,
  type BatchPulseStats,
  type PlanSuggestion,
} from "@/lib/waitlist"
import { formatMoney, formatTime, formatDate } from "@/lib/format"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogMedia,
} from "@/components/ui/alert-dialog"

const PDF_MARGIN = 14
const PDF_LINE = 6

function downloadPrepListPdf(
  batch: Batch,
  orders: SellerOrder[],
  perProduct: Map<string, { name: string; units: number }>,
  slots: Map<string, { label: string; orders: { name: string; items: string }[] }>,
  revenue: number,
  currency: string
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - PDF_MARGIN * 2
  let y = PDF_MARGIN

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - PDF_MARGIN) {
      doc.addPage()
      y = PDF_MARGIN
    }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text("Prep list", PDF_MARGIN, y)
  y += 7
  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.text(`${batch.title} · ${formatDate(batch.pickup_date)}`, PDF_MARGIN, y)
  y += 9

  if (perProduct.size > 0) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text("Totals by product", PDF_MARGIN, y)
    y += PDF_LINE
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    for (const p of perProduct.values()) {
      ensureSpace(PDF_LINE)
      doc.text(p.name, PDF_MARGIN, y)
      doc.text(`${p.units} units`, PDF_MARGIN + contentWidth, y, { align: "right" })
      y += PDF_LINE
    }
    y += 2
    ensureSpace(PDF_LINE)
    doc.setFontSize(10)
    doc.text(
      `${orders.length} ${orders.length === 1 ? "order" : "orders"} · Expected revenue: ${formatMoney(revenue, currency)}`,
      PDF_MARGIN,
      y
    )
    y += 8
  }

  if (slots.size > 0) {
    ensureSpace(12)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text("Pickup schedule", PDF_MARGIN, y)
    y += PDF_LINE
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    for (const slot of slots.values()) {
      ensureSpace(PDF_LINE * 2)
      doc.setFont("helvetica", "bold")
      doc.text(slot.label, PDF_MARGIN, y)
      y += PDF_LINE
      doc.setFont("helvetica", "normal")
      for (const o of slot.orders) {
        const lines = doc.splitTextToSize(`${o.name} — ${o.items}`, contentWidth)
        ensureSpace(lines.length * PDF_LINE)
        doc.text(lines, PDF_MARGIN + 3, y)
        y += lines.length * PDF_LINE
      }
    }
  }

  const filename = `prep-list-${batch.pickup_date}-${batch.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`
  doc.save(filename)
}

const STATUS_LABEL: Record<SellerOrder["status"], string> = {
  pending: "New",
  confirmed: "Ready",
  fulfilled: "Picked up",
  cancelled: "Cancelled",
}

type StatusFilter = "all" | "pending" | "confirmed" | "fulfilled" | "cancelled"

export function OrdersPage() {
  const { seller } = useAuth()
  const [batches, setBatches] = React.useState<(Batch & { units_left: number })[] | null>(null)
  const [batchId, setBatchId] = React.useState<string>("")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  const [orders, setOrders] = React.useState<SellerOrder[] | null>(null)
  const [cancelling, setCancelling] = React.useState<SellerOrder | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [waitlist, setWaitlist] = React.useState<WaitlistEntry[] | null>(null)
  const [pulse, setPulse] = React.useState<BatchPulseStats | null>(null)
  const [plan, setPlan] = React.useState<PlanSuggestion | null>(null)
  const [pulseLoading, setPulseLoading] = React.useState(true)
  const [skippingId, setSkippingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!seller) return
    ;(async () => {
      const { data } = await supabase
        .from("batches")
        .select("*")
        .eq("seller_id", seller.id)
        .order("pickup_date", { ascending: true })
      const { data: items } = await supabase
        .from("batch_items")
        .select("batch_id, units_available")
        .in("batch_id", (data ?? []).map((b) => b.id))
      const list = (data ?? []).map((b) => ({
        ...b,
        units_left: (items ?? [])
          .filter((i) => i.batch_id === b.id)
          .reduce((s, i) => s + i.units_available, 0),
      }))
      setBatches(list)
      // Default to the nearest upcoming open batch; fall back to most recent
      const today = new Date().toISOString().slice(0, 10)
      const open = list
        .filter((b) => b.status === "open" && b.pickup_date >= today)
        .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date))
      const chosen = open[0] ?? list[list.length - 1]
      if (chosen) setBatchId(chosen.id)
    })()
  }, [seller])

  React.useEffect(() => {
    if (!batchId) return
    let alive = true
    ;(async () => {
      const list = await getSellerOrders(batchId)
      if (alive) setOrders(list)
      const wl = await getBatchWaitlist(batchId)
      if (alive) setWaitlist(wl)
    })()
    return () => {
      alive = false
    }
  }, [batchId])

  React.useEffect(() => {
    if (!seller || !batchId) return
    let alive = true
    setPulseLoading(true)
    ;(async () => {
      const [p, s] = await Promise.all([getBatchPulse(batchId), getBatchPlanSuggestion()])
      if (alive) {
        setPulse(p)
        setPlan(s)
        setPulseLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [seller, batchId])

  async function refresh() {
    if (!batchId || !seller) return
    setOrders(await getSellerOrders(batchId))
    // units may have changed after cancel; refresh the batch list quietly
    const { data } = await supabase
      .from("batches")
      .select("*")
      .eq("seller_id", seller.id)
      .order("pickup_date", { ascending: true })
    const { data: items } = await supabase
        .from("batch_items")
        .select("batch_id, units_available")
        .in("batch_id", (data ?? []).map((b) => b.id))
    setBatches(
      (data ?? []).map((b) => ({
        ...b,
        units_left: (items ?? [])
          .filter((i) => i.batch_id === b.id)
          .reduce((s, i) => s + i.units_available, 0),
      }))
    )
  }

  async function handleStatus(order: SellerOrder, status: "pending" | "confirmed" | "fulfilled") {
    setBusyId(order.id)
    const ok = await setOrderStatus(order.id, status)
    setBusyId(null)
    if (ok) {
      await refresh()
      if (status === "confirmed") toast.success(`Order ${order.code} marked Ready.`)
      if (status === "fulfilled") toast.success(`Order ${order.code} picked up. Enjoy!`)
    } else {
      toast.error("Couldn't update the order. Please try again.")
    }
  }

  async function handlePaid(order: SellerOrder, paid: boolean) {
    setBusyId(order.id)
    const ok = await setOrderPaid(order.id, paid)
    setBusyId(null)
    if (ok) {
      await refresh()
      toast.success(paid ? `Order ${order.code} marked as paid.` : `Order ${order.code} marked as unpaid.`)
    } else {
      toast.error("Couldn't update payment. Please try again.")
    }
  }

  async function handleSkip(entry: WaitlistEntry) {
    setSkippingId(entry.id)
    const ok = await skipWaitlistEntry(entry.id)
    setSkippingId(null)
    if (ok) {
      toast.success(`${entry.customer_name} skipped — their spot went to the next person in line.`)
      setWaitlist(await getBatchWaitlist(batchId))
    } else {
      toast.error("Couldn't skip this entry. Please try again.")
    }
  }

  async function handleCancel() {
    if (!cancelling) return
    const result = await cancelOrder(cancelling.id)
    if (result.ok) {
      toast.success(`Order ${cancelling.code} cancelled — units returned to the batch.`)
      await refresh()
      if (batchId) setWaitlist(await getBatchWaitlist(batchId))
    } else if (result.error === "already_fulfilled") {
      toast.error("This order was already picked up, so it can't be cancelled.")
    } else {
      toast.error("Couldn't cancel the order. Please try again.")
    }
    setCancelling(null)
  }

  if (batches === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-orders from your storefront land here.
          </p>
        </div>
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>No batches yet</EmptyTitle>
            <EmptyDescription>
              Create a batch first — orders arrive once your storefront is live.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const selectedBatch = batches.find((b) => b.id === batchId)
  const active = (orders ?? []).filter((o) => o.status !== "cancelled")
  const cancelled = (orders ?? []).filter((o) => o.status === "cancelled")
  const filtered = statusFilter === "all" ? orders ?? [] : (orders ?? []).filter((o) => o.status === statusFilter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-orders from your storefront land here.
        </p>
      </div>

      {/* Summary strip */}
      <SummaryStrip
        orders={orders ?? []}
        currency={seller?.currency ?? "USD"}
        unitsLeft={selectedBatch?.units_left ?? 0}
      />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Filter by batch">
            <SelectValue placeholder="Choose a batch" />
          </SelectTrigger>
          <SelectContent>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.title} · {formatDate(b.pickup_date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">New</SelectItem>
            <SelectItem value="confirmed">Ready</SelectItem>
            <SelectItem value="fulfilled">Picked up</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedBatch && <PrepList orders={active} currency={seller?.currency ?? "USD"} batch={selectedBatch} />}

      {/* Order cards */}
      {orders === null ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>
              {cancelled.length === (orders ?? []).length && orders!.length > 0
                ? "All orders here are cancelled"
                : "No orders yet"}
            </EmptyTitle>
            <EmptyDescription>
              No orders yet. Share your storefront link to get your first one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 print:hidden">
          {filtered.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              currency={seller?.currency ?? "USD"}
              busy={busyId === o.id}
              onReady={() => handleStatus(o, "confirmed")}
              onPickedUp={() => handleStatus(o, "fulfilled")}
              onTogglePaid={() => handlePaid(o, o.payment_status !== "paid")}
              onCancel={() => setCancelling(o)}
            />
          ))}
        </div>
      )}

      <WaitlistCard
        entries={waitlist}
        skippingId={skippingId}
        onSkip={handleSkip}
      />

      <BatchPulseCard pulse={pulse} loading={pulseLoading} />

      <PlanCard plan={plan} loading={pulseLoading} />

      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <X />
            </AlertDialogMedia>
            <AlertDialogTitle>Cancel order {cancelling?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.customer_name}'s items go back into the batch and the
              pickup spot frees up. You can't undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleCancel}>
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WaitlistCard({
  entries,
  skippingId,
  onSkip,
}: {
  entries: WaitlistEntry[] | null
  skippingId: string | null
  onSkip: (entry: WaitlistEntry) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-secondary/50 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Hourglass className="size-4 text-primary" />
          <div>
            <h2 className="font-display text-lg font-semibold">Waitlist</h2>
            <p className="text-sm text-muted-foreground">
              People waiting for a sold-out spot to free up.
            </p>
          </div>
        </div>
      </div>
      <div className="px-5 py-4">
        {entries === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nobody is waiting right now. When a batch sells out, visitors can join the waitlist on
            your storefront.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {entries.map((e) => {
              const claimUrl = e.claim_code
                ? `${window.location.origin}/claim/${e.claim_code}`
                : null
              const wa =
                claimUrl && e.status === "offered"
                  ? waLink(
                      e.phone,
                      `Hi ${e.customer_name}! Good news — a spot for ${e.product_name} just opened up. You have 30 minutes to claim it: ${claimUrl}`
                    )
                  : null
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {e.customer_name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {e.quantity}× {e.product_name}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.phone} · joined {formatDate(e.created_at.slice(0, 10))}
                    </p>
                  </div>
                  {e.status !== "offered" && (
                    <Badge variant="secondary" className="shrink-0">
                      Waiting
                    </Badge>
                  )}
                  {wa && (
                    <Button asChild size="sm" variant="outline" className="rounded-lg">
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="size-3.5" /> Send claim link
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg text-muted-foreground"
                    disabled={skippingId === e.id}
                    onClick={() => onSkip(e)}
                  >
                    {skippingId === e.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <SkipForward className="size-3.5" />
                    )}
                    Skip
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// The API returns the hour as an offset from the first order (0 = first hour).
// Turn it into a readable clock time like "7 PM"; fall back to the raw value.
function hourLabel(hour: string | number, firstOrderAt: string | null): string {
  const offset = Number(hour)
  if (!firstOrderAt || !Number.isFinite(offset)) return String(hour)
  const startHour = parseInt(firstOrderAt.slice(11, 13), 10)
  if (Number.isNaN(startHour)) return String(hour)
  const h = (startHour + offset) % 24
  const suffix = h >= 12 ? "PM" : "AM"
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${suffix}`
}

function BatchPulseCard({
  pulse,
  loading,
}: {
  pulse: BatchPulseStats | null
  loading: boolean
}) {
  const maxOrders = Math.max(1, ...(pulse?.orders_per_hour ?? []).map((h) => h.orders))
  // Hide products with nothing allocated (0/0) so they don't show a misleading 0%
  const sellThrough = (pulse?.product_sell_through ?? [])
    .filter((p) => p.total > 0)
    .map((p) => ({
      ...p,
      pct: Math.round((p.sold / p.total) * 100),
    }))

  const timeline = [
    { label: "First order", at: pulse?.first_order_at ?? null },
    { label: "Half sold", at: pulse?.half_sold_at ?? null },
    { label: "Sold out", at: pulse?.sold_out_at ?? null },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b bg-secondary/50 px-5 py-4">
        <Activity className="size-4 text-primary" />
        <div>
          <h2 className="font-display text-lg font-semibold">Batch Pulse</h2>
          <p className="text-sm text-muted-foreground">
            How fast this batch is selling, hour by hour.
          </p>
        </div>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : !pulse || (!pulse.first_order_at && sellThrough.length === 0) ? (
          <p className="py-2 text-sm text-muted-foreground">
            No pulse yet — this card fills in as orders arrive for the selected batch.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {timeline.map((t) => (
                <div key={t.label} className="rounded-xl border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className="mt-0.5 font-display text-sm font-semibold">
                    {t.at ? formatTime(t.at.slice(11, 16)) : "—"}
                    {t.at && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {formatDate(t.at.slice(0, 10))}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {pulse.orders_per_hour && pulse.orders_per_hour.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Orders per hour
                </p>
                <div className="mt-2 flex h-28 items-end justify-start gap-2 border-b">
                  {pulse.orders_per_hour.map((h, idx) => (
                    <div
                      key={`${h.hour}-${idx}`}
                      className="flex h-full min-w-0 flex-col items-center justify-end gap-1"
                      style={{ flex: "1 1 0%", maxWidth: 56 }}
                      title={`${hourLabel(h.hour, pulse.first_order_at)}: ${h.orders} ${h.orders === 1 ? "order" : "orders"}`}
                    >
                      <span className="text-xs font-medium text-foreground">{h.orders}</span>
                      <div
                        className="w-full rounded-t-md bg-primary/80 transition-all"
                        style={{ height: `${Math.max(6, (h.orders / maxOrders) * 70)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-start gap-2">
                  {pulse.orders_per_hour.map((h, idx) => (
                    <span
                      key={`${h.hour}-${idx}`}
                      className="min-w-0 truncate text-center text-[10px] text-muted-foreground"
                      style={{ flex: "1 1 0%", maxWidth: 56 }}
                    >
                      {hourLabel(h.hour, pulse.first_order_at)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {sellThrough.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sell-through by product
                </p>
                <ul className="mt-2 space-y-2">
                  {sellThrough.map((p) => (
                    <li key={p.name}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground">
                          {p.sold}/{p.total} · {p.pct}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PlanCard({ plan, loading }: { plan: PlanSuggestion | null; loading: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b bg-secondary/50 px-5 py-4">
        <Sparkles className="size-4 text-primary" />
        <div>
          <h2 className="font-display text-lg font-semibold">Plan your next batch</h2>
          <p className="text-sm text-muted-foreground">
            Based on how your last few batches went.
          </p>
        </div>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <Skeleton className="h-14 rounded-xl" />
        ) : !plan || !plan.has_history ? (
          <p className="py-2 text-sm text-muted-foreground">
            {plan?.message ??
              "Run a batch or two and this card will suggest how many units to make next time."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-xl bg-secondary/60 px-4 py-3">
              <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">{plan.suggestion ?? plan.message}</p>
                {plan.last_batch_speed && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.last_batch_title} — {plan.last_batch_speed}
                  </p>
                )}
              </div>
            </div>
            {(plan.best_product || plan.slowest_product) && (
              <p className="text-sm text-muted-foreground">
                {plan.best_product && (
                  <>
                    <strong className="text-foreground">{plan.best_product}</strong> is your best
                    seller
                  </>
                )}
                {plan.best_product && plan.slowest_product && " · "}
                {plan.slowest_product && (
                  <>
                    <strong className="text-foreground">{plan.slowest_product}</strong> moved the
                    slowest
                  </>
                )}
                .
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryStrip({
  orders,
  currency,
  unitsLeft,
}: {
  orders: SellerOrder[]
  currency: string
  unitsLeft: number
}) {
  const today = new Date().toISOString().slice(0, 10)
  const activeOrders = orders.filter((o) => o.status !== "cancelled" && o.status !== "fulfilled")
  const todayCount = activeOrders.filter(
    (o) => (o.created_at ?? "").slice(0, 10) === today
  ).length
  const revenuePaid = orders
    .filter((o) => o.status !== "cancelled" && o.payment_status === "paid")
    .reduce((s, o) => s + o.total, 0)
  const unpaid = orders
    .filter((o) => o.status !== "cancelled" && o.payment_status === "unpaid")
    .reduce((s, o) => s + o.total, 0)

  const cells = [
    { label: "Orders today", value: String(todayCount) },
    { label: "Revenue (paid)", value: formatMoney(revenuePaid, currency) },
    { label: "Unpaid amount", value: formatMoney(unpaid, currency) },
    { label: "Units left (open batch)", value: String(unitsLeft) },
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className="mt-0.5 truncate font-display text-lg font-semibold">{c.value}</p>
        </div>
      ))}
    </div>
  )
}

function PrepList({
  orders,
  currency,
  batch,
}: {
  orders: SellerOrder[]
  currency: string
  batch: Batch
}) {
  const perProduct = new Map<string, { name: string; units: number }>()
  for (const o of orders) {
    for (const item of o.items) {
      const entry = perProduct.get(item.product_id) ?? { name: item.name, units: 0 }
      entry.units += item.quantity
      perProduct.set(item.product_id, entry)
    }
  }
  const revenue = orders.reduce((s, o) => s + o.total, 0)
  const slots = new Map<string, { label: string; orders: { name: string; items: string }[] }>()
  for (const o of orders) {
    const label = o.slot_start
      ? `${formatTime(o.slot_start)}–${formatTime(o.slot_end ?? o.slot_start)}`
      : "No pickup time chosen"
    const entry = slots.get(o.pickup_slot_id ?? "none") ?? { label, orders: [] }
    entry.orders.push({
      name: o.customer_name,
      items: o.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
    })
    slots.set(o.pickup_slot_id ?? "none", entry)
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-secondary/50 px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Prep list</h2>
          <p className="text-sm text-muted-foreground">
            {batch.title} · {formatDate(batch.pickup_date)}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={orders.length === 0}
            onClick={() => {
              try {
                downloadPrepListPdf(batch, orders, perProduct, slots, revenue, currency)
                toast.success("Prep list PDF downloaded.")
              } catch {
                toast.error("Couldn't generate the PDF. Please try again.")
              }
            }}
          >
            <FileDown className="size-4" /> Download PDF
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => window.print()}>
            <Printer className="size-4" /> Print prep list
          </Button>
        </div>
      </div>

      <div className="px-5 py-4">
        {orders.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing to prep yet — the list fills in as orders arrive.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 print:grid-cols-2">
              {[...perProduct.values()].map((p) => (
                <div key={p.name} className="flex items-baseline justify-between rounded-xl border px-3 py-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="font-display text-lg font-semibold text-primary">
                    {p.units}
                    <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                      units
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span>
                <strong className="text-foreground">{orders.length}</strong>{" "}
                {orders.length === 1 ? "order" : "orders"}
              </span>
              <span>
                Expected revenue:{" "}
                <strong className="text-foreground">{formatMoney(revenue, currency)}</strong>
              </span>
            </div>

            <Separator className="my-4" />

            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Pickup schedule
            </h3>
            <div className="mt-2 space-y-3">
              {[...slots.entries()].map(([key, slot]) => (
                <div key={key} className="rounded-xl border px-3 py-2.5">
                  <p className="text-sm font-semibold">{slot.label}</p>
                  <ul className="mt-1.5 space-y-1">
                    {slot.orders.map((o, i) => (
                      <li key={i} className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{o.name}</span> — {o.items}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OrderCard({
  order,
  currency,
  busy,
  onReady,
  onPickedUp,
  onTogglePaid,
  onCancel,
}: {
  order: SellerOrder
  currency: string
  busy: boolean
  onReady: () => void
  onPickedUp: () => void
  onTogglePaid: () => void
  onCancel: () => void
}) {
  const wa = waLink(
    order.phone,
    `Hi ${order.customer_name}! This is about your order ${order.code}` +
      (order.slot_start
        ? ` — pickup ${formatTime(order.slot_start)}–${formatTime(order.slot_end ?? order.slot_start)}`
        : "") +
      ". See you then!"
  )
  const isCancelled = order.status === "cancelled"

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-opacity",
        isCancelled && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold tracking-widest text-primary">{order.code}</p>
          <h3 className="mt-0.5 font-semibold leading-snug">{order.customer_name}</h3>
          <p className="text-sm text-muted-foreground">{order.phone}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={order.status === "fulfilled" ? "secondary" : isCancelled ? "destructive" : "default"}
          >
            {STATUS_LABEL[order.status]}
          </Badge>
          <Badge variant={order.payment_status === "paid" ? "secondary" : "outline"}>
            {order.payment_status === "paid" ? "Paid" : "Unpaid"}
          </Badge>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {order.items.map((i, idx) => (
          <li key={idx} className="flex items-baseline justify-between gap-2">
            <span>
              <span className="font-semibold">{i.quantity}×</span> {i.name}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {formatMoney(i.unit_price * i.quantity, currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {order.slot_start
            ? `${formatTime(order.slot_start)}–${formatTime(order.slot_end ?? order.slot_start)}`
            : "No slot chosen"}
        </span>
        <span className="font-display text-lg font-semibold text-primary">
          {formatMoney(order.total, currency)}
        </span>
      </div>

      {order.notes && (
        <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm italic text-muted-foreground">
          “{order.notes}”
        </p>
      )}

      <div className="mt-auto pt-4 print:hidden">
        <Separator className="mb-3" />
        <div className="flex flex-wrap items-center gap-2">
          {!isCancelled && order.status === "pending" && (
            <Button size="sm" className="rounded-lg" disabled={busy} onClick={onReady}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Utensils className="size-3.5" />}
              Ready
            </Button>
          )}
          {!isCancelled && order.status === "confirmed" && (
            <Button size="sm" className="rounded-lg" disabled={busy} onClick={onPickedUp}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
              Picked up
            </Button>
          )}
          {!isCancelled && (
            <Button size="sm" variant="outline" className="rounded-lg" disabled={busy} onClick={onTogglePaid}>
              <Wallet className="size-3.5" />
              {order.payment_status === "paid" ? "Mark unpaid" : "Mark paid"}
            </Button>
          )}
          {wa && (
            <Button asChild size="sm" variant="outline" className="rounded-lg">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            </Button>
          )}
          {!isCancelled && order.status !== "fulfilled" && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto rounded-lg text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={onCancel}
            >
              <Receipt className="size-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}