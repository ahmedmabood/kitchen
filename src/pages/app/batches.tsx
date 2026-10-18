import * as React from "react"
import { Plus, CalendarDays, Loader2, X, CalendarOff, Copy, RotateCcw, Share2, Download, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { toPng } from "html-to-image"
import { supabase, type Batch, type Product, type PickupSlot } from "@/lib/supabase"
import { reopenBatch, duplicateBatch } from "@/lib/orders"
import { getBatchPlanSuggestion, type PlanSuggestion } from "@/lib/waitlist"
import { useAuth } from "@/lib/auth"
import { formatDate, formatMoney, formatTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

type BatchWithItems = Batch & {
  items: { product: Product; units_available: number }[]
  slots: PickupSlot[]
  units_left: number
}

type DraftSlot = { start_time: string; end_time: string; max_orders: string }
type DraftItem = { product: Product; units: string }

type CaptionStyle = "short" | "friendly" | "urgent"

export function BatchesPage() {
  const { seller } = useAuth()
  const [batches, setBatches] = React.useState<BatchWithItems[] | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [closing, setClosing] = React.useState<BatchWithItems | null>(null)
  const [duplicating, setDuplicating] = React.useState<BatchWithItems | null>(null)
  const [dupDate, setDupDate] = React.useState("")
  const [dupBusy, setDupBusy] = React.useState(false)
  const [reopening, setReopening] = React.useState<BatchWithItems | null>(null)
  const [sharing, setSharing] = React.useState<BatchWithItems | null>(null)
  const [plan, setPlan] = React.useState<PlanSuggestion | null>(null)

  React.useEffect(() => {
    if (!seller) return
    let alive = true
    ;(async () => {
      const p = await getBatchPlanSuggestion()
      if (alive) setPlan(p)
    })()
    return () => {
      alive = false
    }
  }, [seller])

  const load = React.useCallback(async () => {
    if (!seller) return
    const { data: batchRows, error } = await supabase
      .from("batches")
      .select("*")
      .eq("seller_id", seller.id)
      .order("pickup_date", { ascending: true })
    if (error) {
      toast.error("Couldn't load your batches. Please refresh.")
      setBatches([])
      return
    }
    if (!batchRows || batchRows.length === 0) {
      setBatches([])
      return
    }

    // Only load items and slots that belong to this seller's batches
    const batchIds = batchRows.map((b) => b.id)
    const { data: items } = await supabase
      .from("batch_items")
      .select("*, product:products(*)")
      .in("batch_id", batchIds)
    const { data: slots } = await supabase
      .from("pickup_slots")
      .select("*")
      .in("batch_id", batchIds)

    const list: BatchWithItems[] = batchRows.map((b) => {
      const bItems = (items ?? [])
        .filter((i) => i.batch_id === b.id)
        .map((i) => ({ product: i.product as Product, units_available: i.units_available }))
      const bSlots = (slots ?? []).filter((s) => s.batch_id === b.id)
      const units_left = bItems.reduce((sum, i) => sum + i.units_available, 0)
      return { ...b, items: bItems, slots: bSlots, units_left }
    })

    // Auto-close sold-out batches: every product's units at 0 and capacity > 0
    const soldOut = list.filter(
      (b) => b.status === "open" && b.capacity > 0 && b.items.length > 0 && b.units_left === 0
    )
    if (soldOut.length > 0) {
      await supabase
        .from("batches")
        .update({ status: "closed", closed_reason: "sold_out" })
        .in("id", soldOut.map((b) => b.id))
      soldOut.forEach((b) => {
        b.status = "closed"
        toast.info(`"${b.title}" sold out and was closed automatically.`)
      })
    }

    setBatches(list)
  }, [seller])

  React.useEffect(() => {
    load()
  }, [load])

  async function handleClose() {
    if (!closing) return
    const { error } = await supabase
      .from("batches")
      .update({ status: "closed", closed_reason: "manual" })
      .eq("id", closing.id)
    if (error) {
      toast.error("Couldn't close the batch. Please try again.")
    } else {
      toast.success(`"${closing.title}" is closed. Customers can no longer order from it.`)
      await load()
    }
    setClosing(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Limited drops with a fixed number of units. When they're gone, they're gone.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="rounded-xl">
          <Plus className="size-4" /> New batch
        </Button>
      </div>

      {batches === null ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : batches.length === 0 ? (
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>No batches yet</EmptyTitle>
            <EmptyDescription>
              A batch is one drop — like "Friday Cupcake Box Drop" — with a set
              number of units and a pickup date. Customers pre-order until it
              sells out.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setDialogOpen(true)} className="rounded-xl">
              <Plus className="size-4" /> Create your first batch
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {batches.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              currency={seller?.currency ?? "USD"}
              onClose={() => setClosing(b)}
              onShare={() => setSharing(b)}
              onDuplicate={() => {
                setDuplicating(b)
                setDupDate("")
              }}
              onReopen={() => setReopening(b)}
            />
          ))}
        </div>
      )}

      <BatchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => load()}
      />

      <ShareDropDialog
        batch={sharing}
        shopName={seller?.shop_name ?? "Our kitchen"}
        slug={seller?.slug ?? ""}
        currency={seller?.currency ?? "USD"}
        onOpenChange={(open) => !open && setSharing(null)}
      />

      {/* Duplicate dialog */}
      <Dialog open={!!duplicating} onOpenChange={(open) => !open && setDuplicating(null)}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate "{duplicating?.title}"</DialogTitle>
            <DialogDescription>
              Copies the same products, units, and pickup times to a new date.
              The new batch starts open for pre-orders.
            </DialogDescription>
          </DialogHeader>
          {plan?.has_history && plan.suggested_units && duplicating && (
            <div className="rounded-xl bg-secondary/60 px-4 py-3">
              <p className="text-sm font-semibold">💡 Batchly suggests {plan.suggested_units} units</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{plan.suggestion}</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="dup-date">New pickup date</Label>
            <Input
              id="dup-date"
              type="date"
              value={dupDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDupDate(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : "")}
            />
          </div>
          <Button
            className="w-full rounded-xl"
            disabled={dupBusy || !dupDate}
            onClick={async () => {
              if (!duplicating || !dupDate) return
              setDupBusy(true)
              const result = await duplicateBatch(duplicating.id, dupDate, planUnitsFor(duplicating, plan))
              setDupBusy(false)
              if (result.ok) {
                toast.success(`Batch duplicated — the copy opens for ${formatDate(dupDate)}.`)
                setDuplicating(null)
                setDupDate("")
                await load()
              } else {
                toast.error(
                  result.error === "invalid_date"
                    ? "Pick a date that isn't in the past."
                    : "Couldn't duplicate the batch. Please try again."
                )
              }
            }}
          >
            {dupBusy && <Loader2 className="size-4 animate-spin" />}
            Create duplicate
          </Button>
        </DialogContent>
      </Dialog>

      {/* Reopen confirm */}
      <AlertDialog open={!!reopening} onOpenChange={(open) => !open && setReopening(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <RotateCcw />
            </AlertDialogMedia>
            <AlertDialogTitle>Reopen "{reopening?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers can pre-order the remaining units again. This only works
              because the batch still has units left and the pickup date hasn't
              passed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Never mind</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!reopening) return
                const result = await reopenBatch(reopening.id)
                if (result.ok) {
                  toast.success(`"${reopening.title}" is open again.`)
                } else if (result.error === "pickup_date_passed") {
                  toast.error("Can't reopen — the pickup date has already passed.")
                } else if (result.error === "no_units_left") {
                  toast.error("Can't reopen — every unit is claimed.")
                } else {
                  toast.error("Couldn't reopen the batch. Please try again.")
                }
                setReopening(null)
                await load()
              }}
            >
              Reopen batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!closing} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <CalendarOff />
            </AlertDialogMedia>
            <AlertDialogTitle>Close "{closing?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers won't be able to order from this batch anymore. You can't
              reopen a closed batch, but you can always create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleClose}>
              Close batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function planUnitsFor(batch: BatchWithItems, plan: PlanSuggestion | null): Record<string, number> | undefined {
  if (!plan?.has_history || !plan.suggested_units || batch.items.length === 0) return undefined
  // Spread the suggested units evenly across the batch's products (min 1 each)
  const per = Math.max(1, Math.round(plan.suggested_units / batch.items.length))
  const perProduct: Record<string, number> = {}
  for (const item of batch.items) {
    perProduct[item.product.id] = per
  }
  return perProduct
}

function BatchCard({
  batch,
  currency,
  onClose,
  onShare,
  onDuplicate,
  onReopen,
}: {
  batch: BatchWithItems
  currency: string
  onClose: () => void
  onShare: () => void
  onDuplicate: () => void
  onReopen: () => void
}) {
  const soldOut = batch.status === "closed" && batch.units_left === 0 && batch.items.length > 0
  const canReopen =
    batch.status === "closed" &&
    batch.units_left > 0 &&
    new Date(batch.pickup_date + "T23:59:59") > new Date()
  const pct = batch.capacity > 0 ? Math.min(100, Math.max(0, (batch.units_left / batch.capacity) * 100)) : 0
  const ordered = Math.max(0, batch.capacity - batch.units_left)

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{batch.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="size-3.5" />
            Pickup {formatDate(batch.pickup_date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {batch.status === "open" ? (
            <Badge className="bg-green-700 text-white">Open</Badge>
          ) : soldOut ? (
            <Badge variant="secondary">Sold out</Badge>
          ) : (
            <Badge variant="secondary">Closed</Badge>
          )}
          {canReopen && (
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onReopen}>
              <RotateCcw className="size-3.5" /> Reopen
            </Button>
          )}
          {batch.status === "open" && (
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
              Close batch
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {batch.units_left} of {batch.capacity} units left
          </span>
          <span className="font-medium">
            {ordered} ordered
          </span>
        </div>
        <Progress value={pct} className="h-2.5" />
      </div>

      {batch.items.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm">
          {batch.items.map((i) => (
            <li key={i.product.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{i.product.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {i.units_available} left · {formatMoney(Number(i.product.price), currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {batch.slots.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Pickup slots:{" "}
          {batch.slots
            .map((s) => `${formatTime(s.start_time)}–${formatTime(s.end_time)}`)
            .join(", ")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1 print:hidden">
        {batch.status === "open" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg text-primary"
            onClick={onShare}
          >
            <Share2 className="size-3.5" /> Share this drop
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-lg text-primary"
          onClick={onDuplicate}
        >
          <Copy className="size-3.5" /> Duplicate batch
        </Button>
      </div>
    </div>
  )
}

function ShareDropDialog({
  batch,
  shopName,
  slug,
  currency,
  onOpenChange,
}: {
  batch: BatchWithItems | null
  shopName: string
  slug: string
  currency: string
  onOpenChange: (open: boolean) => void
}) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [captionStyle, setCaptionStyle] = React.useState<CaptionStyle>("short")

  // Remaining units are computed at render so the download always shows current counts
  const left = batch?.units_left ?? 0
  const storefrontUrl = slug ? `${window.location.origin}/s/${slug}` : ""

  const caption = React.useMemo(() => {
    if (!batch) return ""
    const more = batch.items.length > 1 ? ` + ${batch.items.length - 1} more` : ""
    if (captionStyle === "short") {
      return `🧁 ${batch.title} — pickup ${formatDate(batch.pickup_date)}. Only ${left} left! Order: ${storefrontUrl}`
    }
    if (captionStyle === "friendly") {
      return `Hi everyone! 👋 Our ${batch.title} is open for pre-orders — pickup on ${formatDate(batch.pickup_date)}. This round has ${batch.items
        .map((i) => i.product.name)
        .join(", ")}${more}. ${left} ${left === 1 ? "spot" : "spots"} left, grab yours: ${storefrontUrl}`
    }
    return `⏰ Almost gone! Only ${left} ${left === 1 ? "unit" : "units"} left for ${batch.title} (${formatDate(batch.pickup_date)}). Once they're gone, they're gone — order now: ${storefrontUrl}`
  }, [batch, captionStyle, left, storefrontUrl])

  async function handleDownload() {
    if (!cardRef.current || !batch) return
    setDownloading(true)
    try {
      const dataUrl = await toPng(cardRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
        cacheBust: true,
      })
      const link = document.createElement("a")
      link.download = `${batch.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-drop.png`
      link.href = dataUrl
      link.click()
      toast.success("Drop card downloaded — ready to post.")
    } catch {
      toast.error("Couldn't create the image. Please try again.")
    } finally {
      setDownloading(false)
    }
  }

  async function handleCopyCaption() {
    try {
      await navigator.clipboard.writeText(caption)
      toast.success("Caption copied to your clipboard.")
    } catch {
      toast.error("Couldn't copy the caption. Please copy it manually.")
    }
  }

  // wa.me with no number opens WhatsApp's "share to..." picker with the caption prefilled
  const wa = batch ? `https://wa.me/?text=${encodeURIComponent(caption)}` : null

  return (
    <Dialog open={!!batch} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this drop</DialogTitle>
          <DialogDescription>
            A story-ready card and caption for WhatsApp or Instagram.
          </DialogDescription>
        </DialogHeader>
        {batch && (
          <div className="space-y-4">
            {/* 1080×1920 story preview, scaled to fit */}
            <div className="flex justify-center">
              <div className="h-[420px] w-[236px] overflow-hidden rounded-xl border shadow-sm">
                <div
                  ref={cardRef}
                  style={{
                    width: 1080,
                    height: 1920,
                    transform: "scale(0.218)",
                    transformOrigin: "top left",
                    background: "#FBF3E7",
                    color: "#7A3B22",
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    display: "flex",
                    flexDirection: "column",
                    padding: "80px 72px",
                  }}
                >
                  <p style={{ fontSize: 44, letterSpacing: 4, textTransform: "uppercase", opacity: 0.75 }}>
                    {shopName}
                  </p>
                  <h1 style={{ fontSize: 96, lineHeight: 1.1, margin: "24px 0 8px", fontWeight: 700 }}>
                    {batch.title}
                  </h1>
                  <p style={{ fontSize: 48, opacity: 0.85 }}>🥐 Pickup {formatDate(batch.pickup_date)}</p>
                  <div
                    style={{
                      marginTop: 64,
                      background: "#E2725B",
                      color: "#FBF3E7",
                      borderRadius: 48,
                      padding: "56px 48px",
                      textAlign: "center",
                    }}
                  >
                    <p style={{ fontSize: 200, fontWeight: 700, lineHeight: 1 }}>{left}</p>
                    <p style={{ fontSize: 56, marginTop: 8 }}>
                      {left === 1 ? "unit left" : "units left"}
                    </p>
                  </div>
                  <div style={{ marginTop: 64 }}>
                    <p style={{ fontSize: 40, letterSpacing: 3, textTransform: "uppercase", opacity: 0.7 }}>
                      On the menu
                    </p>
                    <ul style={{ marginTop: 24 }}>
                      {batch.items.map((i) => (
                        <li
                          key={i.product.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 44,
                            padding: "18px 0",
                            borderBottom: "2px dashed rgba(122,59,34,0.3)",
                          }}
                        >
                          <span>🧁 {i.product.name}</span>
                          <span style={{ fontWeight: 700 }}>
                            {formatMoney(Number(i.product.price), currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p style={{ marginTop: "auto", fontSize: 40, opacity: 0.8, wordBreak: "break-all" }}>
                    Order at {storefrontUrl}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Caption style</Label>
              <div className="flex gap-2">
                {(
                  [
                    ["short", "Short"],
                    ["friendly", "Friendly"],
                    ["urgent", "Urgent"],
                  ] as [CaptionStyle, string][]
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={captionStyle === value ? "default" : "outline"}
                    className="flex-1 rounded-lg"
                    onClick={() => setCaptionStyle(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="rounded-xl border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                {caption}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 rounded-xl"
                disabled={downloading}
                onClick={handleDownload}
              >
                {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Download image
              </Button>
              <Button variant="outline" className="flex-1 rounded-xl" onClick={handleCopyCaption}>
                <Copy className="size-4" /> Copy caption
              </Button>
              {wa && (
                <Button asChild variant="outline" className="flex-1 rounded-xl">
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-4" /> WhatsApp
                  </a>
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The image always shows the units still available right now — download it fresh before
              posting.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BatchDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { seller } = useAuth()
  const [products, setProducts] = React.useState<Product[] | null>(null)
  const [title, setTitle] = React.useState("")
  const [pickupDate, setPickupDate] = React.useState("")
  const [draftItems, setDraftItems] = React.useState<DraftItem[]>([])
  const [draftSlots, setDraftSlots] = React.useState<DraftSlot[]>([
    { start_time: "16:00", end_time: "18:00", max_orders: "10" },
  ])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open || !seller) return
    let alive = true
    setProducts(null)
    ;(async () => {
      // Only this seller's visible products
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("seller_id", seller.id)
        .eq("active", true)
        .order("created_at", { ascending: true })
      if (alive) setProducts(data ?? [])
    })()
    setTitle("")
    setPickupDate("")
    setDraftItems([])
    setDraftSlots([{ start_time: "16:00", end_time: "18:00", max_orders: "10" }])
    setErrors({})
    return () => {
      alive = false
    }
  }, [open, seller?.id])

  function toggleProduct(p: Product, checked: boolean) {
    setDraftItems((prev) =>
      checked ? [...prev, { product: p, units: "12" }] : prev.filter((i) => i.product.id !== p.id)
    )
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = "Give the batch a name customers will recognize."
    if (!pickupDate) next.pickupDate = "Pick a pickup date."
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate))
      next.pickupDate = "That date doesn't look complete — pick it from the calendar."
    else {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (new Date(pickupDate + "T00:00:00") < today)
        next.pickupDate = "The pickup date can't be in the past."
    }
    if (draftItems.length === 0)
      next.items = "Choose at least one product for this batch."
    for (const item of draftItems) {
      const n = Number(item.units)
      if (!item.units.trim() || Number.isNaN(n) || !Number.isInteger(n) || n < 1)
        next.items = `Units for "${item.product.name}" must be a whole number of at least 1.`
    }
    if (draftSlots.length === 0) next.slots = "Add at least one pickup time slot."
    for (const s of draftSlots) {
      if (!s.start_time || !s.end_time) next.slots = "Every slot needs a start and end time."
      else if (s.end_time <= s.start_time)
        next.slots = "A slot's end time must be after its start time."
      const m = Number(s.max_orders)
      if (!s.max_orders.trim() || Number.isNaN(m) || !Number.isInteger(m) || m < 1)
        next.slots = "Max orders per slot must be a whole number of at least 1."
    }
    if (!next.slots) {
      const sorted = [...draftSlots].sort((a, b) => a.start_time.localeCompare(b.start_time))
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start_time < sorted[i - 1].end_time) {
          next.slots = `Pickup slots can't overlap — "${formatTime(sorted[i - 1].start_time)}–${formatTime(sorted[i - 1].end_time)}" and "${formatTime(sorted[i].start_time)}–${formatTime(sorted[i].end_time)}" do.`
          break
        }
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const { data: batch, error } = await supabase
        .from("batches")
        .insert({
          title: title.trim(),
          pickup_date: pickupDate,
          capacity: draftItems.reduce((sum, i) => sum + Number(i.units), 0),
          status: "open",
        })
        .select()
        .single()
      if (error) throw error

      await supabase.from("batch_items").insert(
        draftItems.map((i) => ({
          batch_id: batch.id,
          product_id: i.product.id,
          units_available: Number(i.units),
        }))
      )
      await supabase.from("pickup_slots").insert(
        draftSlots.map((s) => ({
          batch_id: batch.id,
          start_time: s.start_time,
          end_time: s.end_time,
          max_orders: Number(s.max_orders),
        }))
      )

      toast.success(`"${batch.title}" is open for pre-orders!`)
      onCreated()
      onOpenChange(false)
    } catch {
      toast.error("Something went wrong creating the batch. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a batch</DialogTitle>
          <DialogDescription>
            Pick products, set how many units you can make, and choose your
            pickup window. Customers order until every unit is claimed.
          </DialogDescription>
        </DialogHeader>

        {products === null ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed p-6 text-center">
            <p className="text-sm font-medium">You need at least one visible product first.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Head to the Products tab and add what you'll be selling.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="batch-title">Batch title</Label>
              <Input
                id="batch-title"
                placeholder="e.g. Friday Cupcake Box Drop"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={!!errors.title}
              />
              {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch-date">Pickup date</Label>
              <Input
                id="batch-date"
                type="date"
                value={pickupDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPickupDate(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : "")}
                aria-invalid={!!errors.pickupDate}
              />
              {errors.pickupDate && (
                <p className="text-sm text-destructive">{errors.pickupDate}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Products in this batch</Label>
              <div className="divide-y rounded-xl border">
                {products.map((p) => {
                  const selected = draftItems.some((i) => i.product.id === p.id)
                  const item = draftItems.find((i) => i.product.id === p.id)
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Checkbox
                        id={`prod-${p.id}`}
                        checked={selected}
                        onCheckedChange={(v) => toggleProduct(p, v === true)}
                      />
                      <Label
                        htmlFor={`prod-${p.id}`}
                        className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                      >
                        {p.name}
                      </Label>
                      {selected && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            value={item?.units ?? ""}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((i) =>
                                  i.product.id === p.id ? { ...i, units: e.target.value } : i
                                )
                              )
                            }
                            className="h-8 w-20"
                            aria-label={`Units available for ${p.name}`}
                          />
                          <span className="text-xs text-muted-foreground">units</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {errors.items && <p className="text-sm text-destructive">{errors.items}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Pickup time slots</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg text-primary"
                  onClick={() =>
                    setDraftSlots((prev) => [
                      ...prev,
                      { start_time: "17:00", end_time: "19:00", max_orders: "10" },
                    ])
                  }
                >
                  <Plus className="size-3.5" /> Add slot
                </Button>
              </div>
              <div className="space-y-2">
                {draftSlots.map((s, idx) => (
                  <div
                    key={idx}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border p-2.5"
                  >
                    <Input
                      type="time"
                      value={s.start_time}
                      onChange={(e) =>
                        setDraftSlots((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, start_time: e.target.value } : x))
                        )
                      }
                      className="h-8 min-w-0 w-full"
                      aria-label="Slot start time"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={s.end_time}
                      onChange={(e) =>
                        setDraftSlots((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, end_time: e.target.value } : x))
                        )
                      }
                      className="h-8 min-w-0 w-full"
                      aria-label="Slot end time"
                    />
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={s.max_orders}
                      onChange={(e) =>
                        setDraftSlots((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, max_orders: e.target.value } : x))
                        )
                      }
                      className="h-8 min-w-0 w-20"
                      aria-label="Max orders for this slot"
                    />
                    <span className="hidden text-xs text-muted-foreground sm:inline">max orders</span>
                    {draftSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDraftSlots((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove slot"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {errors.slots && <p className="text-sm text-destructive">{errors.slots}</p>}
            </div>

            <Button type="submit" className="w-full rounded-xl" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Open batch for pre-orders
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}