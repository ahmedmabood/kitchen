import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { CalendarDays, Check, Clock, MapPin, MessageCircle, ShoppingBasket, Wallet, ChefHat } from "lucide-react"
import { getOrderByCode, type OrderDetails } from "@/lib/orders"
import { formatDate, formatMoney, formatTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export function OrderConfirmationPage() {
  const { code } = useParams<{ code: string }>()
  const [order, setOrder] = React.useState<OrderDetails | null | undefined>(undefined)

  React.useEffect(() => {
    if (!code) return
    ;(async () => {
      setOrder(await getOrderByCode(code))
    })()
  }, [code])

  if (order === undefined) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6 px-6 py-12">
        <Skeleton className="h-16 w-16 rounded-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChefHat />
            </EmptyMedia>
            <EmptyTitle>Order not found</EmptyTitle>
            <EmptyDescription>
              We couldn't find an order with that code. Double-check the link
              from your confirmation.
            </EmptyDescription>
          </EmptyHeader>
          <Link to="/" className="text-sm font-medium text-primary hover:underline">
            Back to home
          </Link>
        </Empty>
      </div>
    )
  }

  const waMessage = encodeURIComponent(
    `Hi! I placed an order with ${order.shop_name}. My order code is ${order.code}. ` +
      `Pickup: ${formatDate(order.pickup_date)}` +
      (order.pickup_start ? `, ${formatTime(order.pickup_start)}–${formatTime(order.pickup_end ?? order.pickup_start)}` : "") +
      (order.pickup_address ? ` at ${order.pickup_address}.` : ".")
  )
  const waUrl = `https://wa.me/?text=${waMessage}`
  const sellerWa = order.seller_whatsapp
    ? `https://wa.me/${order.seller_whatsapp.replace(/\D/g, "")}?text=${waMessage}`
    : null

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto w-full max-w-xl px-6 py-12">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-green-100">
            <Check className="size-7 text-green-700" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
            Order confirmed
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {order.shop_name} has your pre-order. Save your order code below —
            it's your receipt.
          </p>
          <div className="mt-4 rounded-xl border-2 border-dashed border-primary/30 bg-secondary/50 px-5 py-2.5">
            <span className="font-mono text-xl font-bold tracking-[0.2em] text-primary">
              {order.code}
            </span>
          </div>
        </div>

        {/* Details card */}
        <div className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-secondary/50 px-5 py-4">
            <h2 className="font-display text-lg font-semibold">{order.shop_name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{order.batch_title}</p>
          </div>

          <ul className="divide-y px-5">
            {(order.items ?? []).map((item, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-3">
                <span className="text-sm">
                  <span className="font-semibold">{item.quantity}×</span> {item.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {formatMoney(Number(item.unit_price) * item.quantity, order.currency)}
                </span>
              </li>
            ))}
          </ul>

          <Separator />

          <div className="space-y-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Pickup</p>
                <p className="text-sm text-muted-foreground">{formatDate(order.pickup_date)}</p>
              </div>
            </div>
            {order.pickup_start && (
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Time window</p>
                  <p className="text-sm text-muted-foreground">
                    {formatTime(order.pickup_start)}–{formatTime(order.pickup_end ?? order.pickup_start)}
                  </p>
                </div>
              </div>
            )}
            {order.pickup_address && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Pickup address</p>
                  <p className="text-sm text-muted-foreground">{order.pickup_address}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Payment</p>
                <p className="text-sm text-muted-foreground">
                  Pay on pickup — {formatMoney(Number(order.total), order.currency)} due then.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between px-5 py-4">
            <span className="font-display text-lg font-semibold">Total</span>
            <div className="text-right">
              <span className="font-display text-lg font-semibold text-primary">
                {formatMoney(Number(order.total), order.currency)}
              </span>
              <Badge variant="secondary" className="ml-2 align-middle">
                {order.status}
              </Badge>
            </div>
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="mt-4 rounded-xl border bg-card px-5 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your note to the seller
            </p>
            <p className="mt-1 text-sm">{order.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 space-y-3">
          {sellerWa ? (
            <Button asChild size="lg" className="w-full rounded-xl">
              <a href={sellerWa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" /> Message the seller on WhatsApp
              </a>
            </Button>
          ) : null}
          <Button asChild size="lg" variant="outline" className={sellerWa ? "w-full rounded-xl" : "w-full rounded-xl"}>
            <a href={waUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" /> Share via WhatsApp
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full rounded-xl">
            <Link to={`/s/${order.shop_slug}`}>
              <ShoppingBasket className="size-4" /> Back to storefront
            </Link>
          </Button>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Anyone with this link can see this order, so keep it somewhere safe.
        </p>
      </div>
    </div>
  )
}
