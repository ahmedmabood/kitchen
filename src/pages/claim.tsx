import * as React from "react"
import { Loader2, Clock, PartyPopper, TimerOff, ChefHat } from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { getWaitlistOffer, claimWaitlistOrder, type WaitlistOffer } from "@/lib/waitlist"
import { validatePhoneE164 } from "@/components/ui/phone-input"
import { supabase } from "@/lib/supabase"
import { formatDate, formatMoney, formatTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PhoneInput } from "@/components/ui/phone-input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Badge } from "@/components/ui/badge"

function useCountdown(expiresAt: string | null) {
  const [msLeft, setMsLeft] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!expiresAt) return
    function tick() {
      setMsLeft(new Date(expiresAt!).getTime() - Date.now())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (msLeft === null || msLeft <= 0) return null
  const totalSec = Math.floor(msLeft / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

type Slot = { id: string; start_time: string; end_time: string; max_orders: number }

export function ClaimPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [offer, setOffer] = React.useState<WaitlistOffer | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [slotId, setSlotId] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [errors, setErrors] = React.useState<{ name?: string; phone?: string }>({})
  const [submitting, setSubmitting] = React.useState(false)

  const claimed = React.useRef(false)

  React.useEffect(() => {
    if (!code) return
    ;(async () => {
      // get_waitlist_offer runs process_waitlist server-side first: stale
      // offers are expired and their units released before we read status
      const offer = await getWaitlistOffer(code)
      setOffer(offer)
      setLoading(false)
      if (offer?.status === "offered" && !offer.expired && offer.batch_id) {
        setName(offer.customer_name ?? "")
        setPhone(offer.phone ?? "")
        const { data } = await supabase
          .from("pickup_slots")
          .select("id, start_time, end_time, max_orders")
          .eq("batch_id", offer.batch_id)
        setSlots((data as Slot[]) ?? [])
      }
    })()
  }, [code])

  const countdown = useCountdown(offer?.status === "offered" ? offer.expires_at : null)

  async function handleClaim() {
    if (!code || claimed.current) return
    const next: typeof errors = {}
    if (!name.trim()) next.name = "Please enter your name."
    if (!phone.trim()) next.phone = "Please enter your phone number."
    else {
      const phoneError = validatePhoneE164(phone)
      if (phoneError) next.phone = phoneError
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    const result = await claimWaitlistOrder({
      code,
      customerName: name.trim(),
      phone: phone.trim(),
      pickupSlotId: slotId,
    })
    setSubmitting(false)
    if (result.ok) {
      claimed.current = true
      navigate(`/order/${result.code}`)
    } else if (result.error === "offer_invalid") {
      setOffer((o) => (o ? { ...o, status: "expired" } : o))
      toast.error("This offer is no longer available.")
    } else {
      toast.error("Couldn't confirm your order. Please try again.")
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4 px-6 py-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }

  if (!offer || offer.status === "invalid") {
    return (
      <Centered>
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChefHat />
            </EmptyMedia>
            <EmptyTitle>Link not found</EmptyTitle>
            <EmptyDescription>
              This claim link doesn't exist. Double-check the message it came
              in — maybe a crumb fell on it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Centered>
    )
  }

  if (offer.status === "expired" || (offer.status === "offered" && offer.expired) || offer.status === "claimed") {
    return (
      <Centered>
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {offer.status === "claimed" ? <PartyPopper /> : <TimerOff />}
            </EmptyMedia>
            <EmptyTitle>
              {offer.status === "claimed" ? "Already claimed" : "This offer has expired"}
            </EmptyTitle>
            <EmptyDescription>
              {offer.status === "claimed"
                ? "Your spot was already confirmed — check your order confirmation for details."
                : "The 30-minute window passed and the units were offered to the next person in line. Keep an eye out — you'll be first next time units free up."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Centered>
    )
  }

  const total = Number(offer.unit_price ?? 0) * (offer.quantity ?? 0)

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto w-full max-w-lg space-y-5 px-6 py-10">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            {offer.shop_name}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            A spot opened up!
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You were next in line for {offer.product_name} in "{offer.batch_title}"
            {" "}(pickup {offer.pickup_date ? formatDate(offer.pickup_date) : ""}).
          </p>
        </div>

        <div className="flex items-center justify-between rounded-2xl border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Clock className="size-5 text-amber-700" />
            <div>
              <p className="text-sm font-semibold">Your spot is held for</p>
              <p className="text-xs text-muted-foreground">Confirm before the timer runs out</p>
            </div>
          </div>
          <span className="font-display text-3xl font-semibold tabular-nums text-amber-700">
            {countdown ?? "0:00"}
          </span>
        </div>

        <div className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{offer.product_name}</p>
              <p className="text-sm text-muted-foreground">
                {offer.quantity} × {formatMoney(Number(offer.unit_price), offer.currency ?? "USD")}
              </p>
            </div>
            <Badge variant="default">Held for you</Badge>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-semibold">Total</span>
            <span className="font-display text-lg font-semibold text-primary">
              {formatMoney(total, offer.currency ?? "USD")}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Pay on pickup — nothing due now.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="claim-name">Your name</Label>
            <Input
              id="claim-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              autoComplete="name"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="claim-phone">WhatsApp phone number</Label>
            <PhoneInput
              id="claim-phone"
              value={phone}
              onChange={setPhone}
              ariaInvalid={!!errors.phone}
            />
            {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
          </div>

          {slots.length > 0 && (
            <div className="space-y-1.5">
              <Label>Pickup time</Label>
              <RadioGroup value={slotId ?? ""} onValueChange={(v) => setSlotId(v)} className="gap-2">
                {slots.map((s) => (
                  <Label
                    key={s.id}
                    htmlFor={`claim-slot-${s.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 font-normal transition-colors"
                  >
                    <RadioGroupItem value={s.id} id={`claim-slot-${s.id}`} />
                    {formatTime(s.start_time)}–{formatTime(s.end_time)}
                  </Label>
                ))}
              </RadioGroup>
            </div>
          )}

          <Button
            size="lg"
            className="w-full rounded-xl transition-transform active:scale-[0.98]"
            disabled={submitting || !countdown}
            onClick={handleClaim}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Confirming your spot…
              </>
            ) : (
              "Confirm my spot"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  )
}
