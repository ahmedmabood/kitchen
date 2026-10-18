import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { CalendarDays, Clock, Loader2, MapPin, Minus, Plus, ShoppingBasket, Wallet, MessageCircle, ChefHat, LayoutDashboard } from "lucide-react"
import { supabase, type Seller, type Product, type PickupSlot } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import { placeOrder, getSlotUsage, type SlotUsage, type OrderErrorKind } from "@/lib/orders"
import { PhoneInput, validatePhoneE164 } from "@/components/ui/phone-input"
import { joinWaitlist, processWaitlist } from "@/lib/waitlist"
import { toast } from "sonner"
import { formatDate, formatMoney, formatTime } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

export type WaitlistTarget = {
  batchId: string
  batchTitle: string
  batchDate: string
  productId: string
  productName: string
} | null

type OpenBatch = {
  id: string
  title: string
  pickup_date: string
  capacity: number
  status: "open" | "closed"
  items: { product: Product; units_available: number }[]
  slots: PickupSlot[]
  slotUsage: SlotUsage[]
}

export function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [seller, setSeller] = React.useState<Seller | null>(null)
  const [state, setState] = React.useState<"loading" | "ready" | "notfound">("loading")
  const [batches, setBatches] = React.useState<OpenBatch[] | null>(null)
  // Cross-batch cart: { batchId: { productId: qty } }
  const [cart, setCart] = React.useState<Record<string, Record<string, number>>>({})
  const [drawerBatchId, setDrawerBatchId] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [demoSigningIn, setDemoSigningIn] = React.useState(false)
  const [waitlistTarget, setWaitlistTarget] = React.useState<WaitlistTarget>(null)

  const isDemo = seller?.demo_locked === true

  async function handleDemoSignIn() {
    setDemoSigningIn(true)
    try {
      if (!session) {
        const { error } = await supabase.auth.signInWithPassword({
          email: "demo@maplecrumb.batchly",
          password: "DemoKitchen2026!Maple",
        })
        if (error) {
          toast.error("Couldn't open the demo dashboard. Please try again.")
          setDemoSigningIn(false)
          return
        }
      }
      navigate("/app/orders")
    } catch {
      toast.error("Couldn't open the demo dashboard. Please try again.")
      setDemoSigningIn(false)
    }
  }

  const load = React.useCallback(async () => {
    if (!seller) return
    // Safely expire stale offers on every storefront load (no cron needed)
    const { data: batchIds } = await supabase
      .from("batches")
      .select("id")
      .eq("seller_id", seller.id)
    for (const row of batchIds ?? []) {
      await processWaitlist(row.id)
    }
    // Open batches plus sold-out ones (customers can join the waitlist there)
    const { data: batchRows } = await supabase
      .from("batches")
      .select("*")
      .eq("seller_id", seller.id)
      .or("status.eq.open,and(status.eq.closed,closed_reason.eq.sold_out)")
      .gte("pickup_date", new Date().toISOString().slice(0, 10))
      .order("pickup_date", { ascending: true })
    const { data: items } = await supabase
      .from("batch_items")
      .select("*, product:products(*)")
    const { data: slots } = await supabase.from("pickup_slots").select("*")

    const list: OpenBatch[] = (batchRows ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      pickup_date: b.pickup_date,
      capacity: b.capacity,
      status: b.status,
      items: (items ?? [])
        .filter((i) => i.batch_id === b.id && i.product)
        .map((i) => ({ product: i.product as Product, units_available: i.units_available })),
      slots: (slots ?? []).filter((s) => s.batch_id === b.id),
      slotUsage: [],
    }))

    // Load slot room for every batch
    await Promise.all(
      list.map(async (b) => {
        b.slotUsage = await getSlotUsage(b.id)
      })
    )

    setBatches(list)
  }, [seller?.id])

  React.useEffect(() => {
    if (!slug) return
    let alive = true
    ;(async () => {
      const { data: s } = await supabase
        .from("sellers")
        .select("*")
        .eq("slug", slug)
        .maybeSingle()
      if (!alive) return
      if (!s) {
        setSeller(null)
        setState("notfound")
        return
      }
      setSeller(s)
      setState("ready")
      await load()
    })()
    return () => {
      alive = false
    }
  }, [slug, load])

  // Live counters: poll every 10 seconds
  React.useEffect(() => {
    if (state !== "ready") return
    const id = setInterval(() => {
      load()
    }, 10_000)
    return () => clearInterval(id)
  }, [state, load])

  // Keep cart quantities within live availability (micro-animation on change)
  React.useEffect(() => {
    if (!batches) return
    setCart((prev) => {
      let changed = false
      const next: Record<string, Record<string, number>> = {}
      for (const b of batches) {
        const bc = prev[b.id]
        if (!bc) continue
        const row: Record<string, number> = {}
        for (const item of b.items) {
          const qty = bc[item.product.id]
          if (!qty) continue
          const capped = Math.min(qty, item.units_available)
          if (capped > 0) row[item.product.id] = capped
          if (capped !== qty) changed = true
        }
        if (Object.keys(row).length > 0) next[b.id] = row
      }
      return changed ? next : prev
    })
  }, [batches])

  function setQty(batchId: string, productId: string, delta: number) {
    setCart((prev) => {
      const batch = batches?.find((b) => b.id === batchId)
      const item = batch?.items.find((i) => i.product.id === productId)
      const max = item?.units_available ?? 0
      const current = prev[batchId]?.[productId] ?? 0
      const clamped = Math.max(0, Math.min(current + delta, max))
      const row = { ...(prev[batchId] ?? {}) }
      if (clamped <= 0) delete row[productId]
      else row[productId] = clamped
      return { ...prev, [batchId]: row }
    })
  }

  const drawerBatch = batches?.find((b) => b.id === drawerBatchId) ?? null
  const drawerCart = drawerBatchId ? (cart[drawerBatchId] ?? {}) : {}

  async function handleSubmit(details: {
    name: string
    phone: string
    slotId: string | null
    notes: string | null
  }) {
    if (!drawerBatch) return false
    setSubmitting(true)
    try {
      // Refresh counters right before submitting so we race-check on fresh data
      await load()
      const items = Object.entries(cart[drawerBatch.id] ?? {})
        .filter(([, qty]) => qty > 0)
        .map(([product_id, quantity]) => ({ product_id, quantity }))
      const result = await placeOrder({
        batchId: drawerBatch.id,
        customerName: details.name,
        phone: details.phone,
        pickupSlotId: details.slotId,
        notes: details.notes,
        items,
      })
      if (result.ok) {
        setCart((prev) => ({ ...prev, [drawerBatch.id]: {} }))
        setDrawerBatchId(null)
        window.location.assign(`/order/${result.code}`)
        return true
      }
      await load()
      handleOrderError(result.kind)
      return false
    } catch {
      toast.error("Something went wrong placing your order. Please try again.")
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function handleOrderError(kind: OrderErrorKind) {
    if (kind === "sold_out") {
      toast.error("Sorry, someone just grabbed the last one. Please adjust your order.", {
        duration: 6000,
      })
    } else if (kind === "batch_closed") {
      toast.error("This batch just closed. Check out the other batches!")
    } else if (kind === "slot_full") {
      toast.error("That pickup time just filled up. Please pick another slot.")
    } else if (kind === "invalid_input") {
      toast.error("Please check your name and phone number.")
    } else {
      toast.error("Couldn't place your order. Please try again.")
    }
  }

  if (state === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (state === "notfound" || !seller) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-secondary">
          <ChefHat className="size-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kitchen not found</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            There's no storefront at this address. Double-check the link — maybe
            a crumb fell on it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background">
      {/* Demo banner */}
      {isDemo && (
        <div className="border-b bg-primary px-6 py-3 text-primary-foreground">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Demo kitchen: place a test order, then view the seller side
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-lg"
              disabled={demoSigningIn}
              onClick={handleDemoSignIn}
            >
              {demoSigningIn ? <Loader2 className="size-4 animate-spin" /> : <LayoutDashboard className="size-4" />}
              See the seller dashboard
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-4 px-6 py-8">
          <div className="size-16 shrink-0 overflow-hidden rounded-2xl bg-secondary">
            {seller.logo_url ? (
              <img src={seller.logo_url} alt={seller.shop_name} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center font-display text-2xl font-semibold text-primary">
                {seller.shop_name.charAt(0)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold tracking-tight">
              {seller.shop_name}
            </h1>
            {seller.pickup_address && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" />
                Pickup in {seller.pickup_address}
              </p>
            )}
          </div>
        </div>
        {seller.bio && (
          <div className="mx-auto w-full max-w-2xl px-6 pb-6">
            <p className="text-sm leading-relaxed text-muted-foreground">{seller.bio}</p>
          </div>
        )}
      </header>

      {/* Open batches */}
      <main className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8">
        {batches === null ? (
          <>
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </>
        ) : batches.length === 0 ? (
          <Empty className="rounded-2xl border-2">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShoppingBasket />
              </EmptyMedia>
              <EmptyTitle>Nothing on the menu right now</EmptyTitle>
              <EmptyDescription>
                This kitchen isn't taking pre-orders at the moment. Check back
                soon — new batches drop regularly!
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          batches.map((b) => (
            <StorefrontBatch
              key={b.id}
              batch={b}
              currency={seller.currency}
              cart={cart[b.id] ?? {}}
              isSoldOutBatch={b.status === "closed"}
              onSetQty={(productId, qty) => setQty(b.id, productId, qty - (cart[b.id]?.[productId] ?? 0))}
              onReview={() => setDrawerBatchId(b.id)}
              onJoinWaitlist={(product) =>
                setWaitlistTarget({
                  batchId: b.id,
                  batchTitle: b.title,
                  batchDate: b.pickup_date,
                  productId: product.id,
                  productName: product.name,
                })
              }
            />
          ))
        )}
      </main>

      {drawerBatch && (
        <ReviewDrawer
          batch={drawerBatch}
          cart={drawerCart}
          currency={seller.currency}
          submitting={submitting}
          onSubmit={handleSubmit}
          onSetQty={(productId, qty) => setQty(drawerBatch.id, productId, qty - (drawerCart[productId] ?? 0))}
          onOpenChange={(open) => !open && setDrawerBatchId(null)}
        />
      )}

      <WaitlistDialog
        target={waitlistTarget}
        onOpenChange={(open) => !open && setWaitlistTarget(null)}
      />

      {/* Sticky cart bar */}
      {(() => {
        const batchWithItems = batches?.find((b) =>
          Object.values(cart[b.id] ?? {}).some((q) => q > 0)
        )
        if (!batchWithItems || submitting) return null
        const count = Object.values(cart).reduce(
          (sum, row) => sum + Object.values(row).reduce((s, q) => s + q, 0),
          0
        )
        const total = batches!.reduce(
          (sum, b) =>
            sum +
            b.items.reduce((s, i) => s + (cart[b.id]?.[i.product.id] ?? 0) * Number(i.product.price), 0),
          0
        )
        return (
          <div className="sticky bottom-0 z-40 border-t bg-card/95 px-6 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {count} {count === 1 ? "item" : "items"} · {formatMoney(total, seller.currency)}
                </p>
                <p className="truncate text-xs text-muted-foreground">{batchWithItems.title}</p>
              </div>
              <Button
                className="rounded-xl transition-transform active:scale-[0.98]"
                onClick={() => setDrawerBatchId(batchWithItems.id)}
              >
                Review order
              </Button>
            </div>
          </div>
        )
      })()}

      <footer className="mx-auto w-full max-w-2xl space-y-3 px-6 pb-12 pt-4 text-center">
        {seller.whatsapp_number && (
          <Button asChild variant="outline" className="rounded-xl">
            <a
              href={`https://wa.me/${seller.whatsapp_number.replace(/\D/g, "")}?text=${encodeURIComponent(
                `Hi ${seller.shop_name}! I have a question about pre-orders.`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="size-4" /> Message the seller on WhatsApp
            </a>
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Powered by Batchly · Pre-orders for home kitchens
        </p>
      </footer>
    </div>
  )
}

function StorefrontBatch({
  batch,
  currency,
  cart,
  isSoldOutBatch,
  onSetQty,
  onReview,
  onJoinWaitlist,
}: {
  batch: OpenBatch
  currency: string
  cart: Record<string, number>
  isSoldOutBatch: boolean
  onSetQty: (productId: string, qty: number) => void
  onReview: () => void
  onJoinWaitlist: (product: Product) => void
}) {
  const totalLeft = batch.items.reduce((sum, i) => sum + i.units_available, 0)
  const cartCount = Object.values(cart).reduce((sum, q) => sum + q, 0)
  const cartTotal = batch.items.reduce(
    (sum, i) => sum + (cart[i.product.id] ?? 0) * Number(i.product.price),
    0
  )

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="border-b bg-secondary/50 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">{batch.title}</h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="size-3.5" />
              Pickup {formatDate(batch.pickup_date)}
            </p>
          </div>
          <Badge variant={totalLeft > 0 ? "default" : "secondary"}>
            {totalLeft > 0 ? `${totalLeft} left` : "Sold out"}
          </Badge>
        </div>
        {batch.slots.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5 shrink-0" />
            {batch.slots.map((s) => `${formatTime(s.start_time)}–${formatTime(s.end_time)}`).join(" · ")}
          </p>
        )}
      </div>

      <ul className="divide-y">
        {batch.items.map((item) => (
          <li key={item.product.id} className="flex gap-4 px-6 py-4">
            <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
              {item.product.image_url ? (
                <img
                  src={item.product.image_url}
                  alt={item.product.name}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <ShoppingBasket className="size-6 text-muted-foreground/50" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-medium leading-snug">{item.product.name}</h3>
                <span className="font-semibold text-primary">
                  {formatMoney(Number(item.product.price), currency)}
                </span>
              </div>
              {item.product.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {item.product.description}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <p
                  className={cn(
                    "text-sm font-medium transition-colors",
                    item.units_available === 0
                      ? "text-destructive"
                      : item.units_available <= 3
                        ? "text-amber-700"
                        : "text-muted-foreground"
                  )}
                >
                  {item.units_available === 0
                    ? "Sold out"
                    : item.units_available <= 3
                      ? `Only ${item.units_available} left!`
                      : `${item.units_available} left`}
                </p>
                {item.units_available === 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-xs"
                    onClick={() => onJoinWaitlist(item.product)}
                  >
                    <Clock className="size-3.5" /> Join the waitlist
                  </Button>
                ) : (
                  <QuantityStepper
                    value={cart[item.product.id] ?? 0}
                    max={item.units_available}
                    onChange={(qty) => onSetQty(item.product.id, qty)}
                    label={item.product.name}
                  />
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="px-6 pb-6 pt-2">
        {isSoldOutBatch || totalLeft === 0 ? (
          <div className="rounded-xl bg-secondary/60 px-4 py-3 text-center">
            <p className="text-sm font-semibold">Sold out — but cancellations happen</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Join the waitlist on any item above and you'll get first dibs if a spot frees up.
            </p>
          </div>
        ) : (
          <Button
            size="lg"
            className="w-full rounded-xl transition-transform active:scale-[0.98]"
            disabled={cartCount === 0}
            onClick={onReview}
          >
            {cartCount > 0
              ? `Review order — ${formatMoney(cartTotal, currency)}`
              : "Pick your items above"}
          </Button>
        )}
      </div>
    </section>
  )
}

function WaitlistDialog({
  target,
  onOpenChange,
}: {
  target: WaitlistTarget
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [qty, setQty] = React.useState(1)
  const [submitting, setSubmitting] = React.useState(false)
  const [errors, setErrors] = React.useState<{ name?: string; phone?: string }>({})

  const product = target
    ? { id: target.productId, name: target.productName }
    : null
  const batch = target
    ? { title: target.batchTitle, date: target.batchDate }
    : null

  React.useEffect(() => {
    if (target) {
      setName("")
      setPhone("")
      setQty(1)
      setErrors({})
    }
  }, [target])

  async function handleJoin() {
    if (!target) return
    const next: typeof errors = {}
    if (!name.trim()) next.name = "Please enter your name."
    else if (name.trim().length > 80) next.name = "Please keep your name under 80 characters."
    if (!phone.trim()) next.phone = "Please enter your phone number."
    else {
      const phoneError = validatePhoneE164(phone)
      if (phoneError) next.phone = phoneError
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSubmitting(true)
    const { error } = await joinWaitlist({
      batchId: target.batchId,
      productId: target.productId,
      customerName: name.trim(),
      phone: phone.trim(),
      quantity: qty,
    })
    setSubmitting(false)
    if (error) {
      toast.error(
        error === "phone"
          ? (validatePhoneE164(phone) ?? "That phone number doesn't look right.")
          : error === "name"
            ? "Please enter a shorter name."
            : error === "ended"
              ? "This batch is no longer taking waitlist entries."
              : "Couldn't join the waitlist. Please try again."
      )
      return
    }
    toast.success(
      `You're on the waitlist for ${target.productName}. We'll message you if a spot opens up.`
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Join the waitlist</DialogTitle>
          <DialogDescription>
            {product && batch
              ? `${product.name} · ${batch.title} — pickup ${formatDate(batch.date)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {product && batch && (
          <div className="space-y-4">
            <div className="rounded-xl bg-secondary/60 px-4 py-3">
              <p className="text-sm font-semibold">Sold out — but cancellations happen</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                If a spot frees up, we'll send you a claim link by WhatsApp. You'll have 30 minutes
                to grab it before it moves to the next person.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-name">Your name</Label>
              <Input
                id="waitlist-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
                autoComplete="name"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-phone">WhatsApp phone number</Label>
              <PhoneInput
                id="waitlist-phone"
                value={phone}
                onChange={setPhone}
                ariaInvalid={!!errors.phone}
              />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>How many would you like?</Label>
              <RadioGroup
                value={String(qty)}
                onValueChange={(v) => setQty(Number(v))}
                className="flex gap-2"
              >
                {[1, 2, 3, 4].map((n) => (
                  <Label
                    key={n}
                    htmlFor={`waitlist-qty-${n}`}
                    className={cn(
                      "flex-1 cursor-pointer items-center justify-center rounded-xl border px-2 py-2 text-center font-normal transition-colors",
                      qty === n && "border-primary bg-secondary/60"
                    )}
                  >
                    <RadioGroupItem value={String(n)} id={`waitlist-qty-${n}`} className="sr-only" />
                    {n}
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <Button
              className="w-full rounded-xl"
              disabled={submitting}
              onClick={handleJoin}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Joining…
                </>
              ) : (
                "Join the waitlist"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function QuantityStepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number
  max: number
  onChange: (qty: number) => void
  label: string
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-lg border transition-colors",
        value > 0 ? "border-primary/40 bg-secondary/60" : "bg-background"
      )}
      data-slot="quantity-stepper"
    >
      <button
        type="button"
        aria-label={`Remove one ${label}`}
        className="flex size-8 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-3.5" />
      </button>
      <span
        className={cn(
          "min-w-7 text-center text-sm font-semibold tabular-nums transition-all",
          value > 0 && "animate-in zoom-in-50 duration-200"
        )}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Add one ${label}`}
        className="flex size-8 items-center justify-center rounded-r-lg text-primary transition-colors hover:bg-secondary disabled:opacity-30"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function ReviewDrawer({
  batch,
  cart,
  currency,
  submitting,
  onSubmit,
  onSetQty,
  onOpenChange,
}: {
  batch: OpenBatch
  cart: Record<string, number>
  currency: string
  submitting: boolean
  onSubmit: (details: {
    name: string
    phone: string
    slotId: string | null
    notes: string | null
  }) => Promise<boolean>
  onSetQty: (productId: string, qty: number) => void
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [slotId, setSlotId] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<{ name?: string; phone?: string; slot?: string }>({})

  const lines = batch.items
    .filter((i) => (cart[i.product.id] ?? 0) > 0)
    .map((i) => ({
      product: i.product,
      qty: cart[i.product.id],
      left: i.units_available,
    }))
  const total = lines.reduce((sum, l) => sum + l.qty * Number(l.product.price), 0)

  // Slot usage may have refreshed since the drawer opened; recompute room live
  const usageById = new Map(batch.slotUsage.map((u) => [u.slot_id, u.remaining]))
  const slotRows = batch.slots.map((s) => {
    const remaining = usageById.has(s.id) ? usageById.get(s.id)! : s.max_orders
    return { slot: s, remaining }
  })
  const openSlots = slotRows.filter((r) => r.remaining > 0)

  React.useEffect(() => {
    if (slotId && !openSlots.some((r) => r.slot.id === slotId)) setSlotId(null)
  }, [slotId, openSlots])

  async function handlePlace() {
    const next: typeof errors = {}
    if (!name.trim()) next.name = "Please enter your name."
    else if (name.trim().length > 80) next.name = "Please keep your name under 80 characters."
    if (!phone.trim()) next.phone = "Please enter your phone number."
    else {
      const phoneError = validatePhoneE164(phone)
      if (phoneError) next.phone = phoneError
    }
    if (batch.slots.length > 0 && openSlots.length > 0 && !slotId)
      next.slot = "Please choose a pickup time."
    setErrors(next)
    if (Object.keys(next).length > 0) return
    await onSubmit({ name: name.trim(), phone: phone.trim(), slotId, notes: notes.trim() ? notes.trim().slice(0, 500) : null })
  }

  return (
    <Drawer open onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92svh] w-full max-w-2xl rounded-t-2xl border-x border-t shadow-2xl">
        <div className="mx-auto w-full max-w-xl overflow-y-auto px-5 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle className="font-display">Review your order</DrawerTitle>
            <DrawerDescription>
              {batch.title} · Pickup {formatDate(batch.pickup_date)}
            </DrawerDescription>
          </DrawerHeader>

          {/* Items */}
          <ul className="divide-y rounded-xl border">
            {lines.map((l) => (
              <li key={l.product.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(Number(l.product.price), currency)} each · {l.left} left
                  </p>
                </div>
                <QuantityStepper
                  value={l.qty}
                  max={l.left}
                  onChange={(qty) => onSetQty(l.product.id, qty)}
                  label={l.product.name}
                />
                <span className="w-16 shrink-0 text-right text-sm font-semibold text-primary">
                  {formatMoney(l.qty * Number(l.product.price), currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="order-name">Your name</Label>
              <Input
                id="order-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
                autoComplete="name"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="order-phone">WhatsApp phone number</Label>
              <PhoneInput
                id="order-phone"
                value={phone}
                onChange={setPhone}
                ariaInvalid={!!errors.phone}
              />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>

            {batch.slots.length > 0 && (
              <div className="space-y-1.5">
                <Label>Pickup time</Label>
                {openSlots.length === 0 ? (
                  <p className="rounded-xl border-2 border-dashed p-3 text-sm text-destructive">
                    Every pickup time is full — the seller may add more spots.
                  </p>
                ) : (
                  <RadioGroup
                    value={slotId ?? ""}
                    onValueChange={(v) => setSlotId(v)}
                    className="gap-2"
                  >
                    {openSlots.map(({ slot, remaining }) => (
                      <Label
                        key={slot.id}
                        htmlFor={`slot-${slot.id}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 font-normal transition-colors",
                          slotId === slot.id && "border-primary bg-secondary/60"
                        )}
                      >
                        <RadioGroupItem value={slot.id} id={`slot-${slot.id}`} />
                        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">
                          {formatTime(slot.start_time)}–{formatTime(slot.end_time)}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {remaining} {remaining === 1 ? "spot" : "spots"} left
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                )}
                {slotRows.some((r) => r.remaining <= 0) && openSlots.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Full:{" "}
                    {slotRows
                      .filter((r) => r.remaining <= 0)
                      .map((r) => `${formatTime(r.slot.start_time)}–${formatTime(r.slot.end_time)}`)
                      .join(", ")}
                  </p>
                )}
                {errors.slot && <p className="text-sm text-destructive">{errors.slot}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="order-notes">Notes for the seller (optional)</Label>
              <Textarea
                id="order-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Allergies, gate code, anything else…"
                rows={2}
                maxLength={500}
              />
            </div>
          </div>

          <Separator className="my-4" />

          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-semibold">Total</span>
            <span className="font-display text-lg font-semibold text-primary">
              {formatMoney(total, currency)}
            </span>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Wallet className="size-3.5 shrink-0 text-primary" />
            Pay on pickup — nothing due now.
          </p>

          <Button
            size="lg"
            className="mt-4 w-full rounded-xl transition-transform active:scale-[0.98]"
            disabled={submitting || lines.length === 0}
            onClick={handlePlace}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Placing your order…
              </>
            ) : (
              "Place order"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
