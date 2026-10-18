import * as React from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { ChefHat, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import { slugify } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PhoneInput, validatePhoneE164 } from "@/components/ui/phone-input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "PHP", "NGN", "ZAR", "MXN"]

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

type SlugState = "idle" | "checking" | "available" | "taken" | "invalid"

export function OnboardingPage() {
  const { session, seller, loading, refreshSeller } = useAuth()
  const navigate = useNavigate()

  const [shopName, setShopName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [slugState, setSlugState] = React.useState<SlugState>("idle")
  const [bio, setBio] = React.useState("")
  const [currency, setCurrency] = React.useState("USD")
  const [pickupAddress, setPickupAddress] = React.useState("")
  const [whatsapp, setWhatsapp] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(null)

  React.useEffect(() => {
    if (!slug) {
      setSlugState("idle")
      return
    }
    if (!SLUG_RE.test(slug)) {
      setSlugState("invalid")
      return
    }
    setSlugState("checking")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("sellers")
        .select("id")
        .eq("slug", slug)
        .maybeSingle()
      setSlugState(data && data.id !== session?.user.id ? "taken" : "available")
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [slug, session?.user.id])

  if (loading) return null
  if (!session) return <Navigate to="/auth" replace />
  if (seller) return <Navigate to="/app/orders" replace />

  function handleShopNameChange(value: string) {
    setShopName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!shopName.trim()) next.shopName = "Give your kitchen a name customers will remember."
    if (!slug) next.slug = "Pick a web address for your storefront."
    else if (slugState === "invalid")
      next.slug = "Use 2–40 lowercase letters, numbers, or hyphens. Start with a letter or number."
    else if (slugState === "taken") next.slug = "That address is taken — try another one."
    else if (slugState === "checking") next.slug = "Checking availability, one moment…"
    if (bio.length > 300) next.bio = "Keep your bio under 300 characters."
    if (!pickupAddress.trim()) next.pickupAddress = "Tell customers roughly where they'll pick up orders."
    if (whatsapp.trim() && validatePhoneE164(whatsapp))
      next.whatsapp = "That WhatsApp number doesn't look right — pick your country and enter the number."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !session) return
    setSubmitting(true)
    const { error } = await supabase.from("sellers").insert({
      shop_name: shopName.trim(),
      slug,
      bio: bio.trim() || null,
      currency,
      pickup_address: pickupAddress.trim(),
      whatsapp_number: whatsapp.trim() || null,
    })
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That address was just taken — please pick another one."
          : "We couldn't save your shop details. Please try again."
      )
      setSubmitting(false)
      return
    }
    toast.success("Your kitchen is live! Time to add your first product.")
    await refreshSeller()
    navigate("/app/products", { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className="mx-auto w-full max-w-lg px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Set up your kitchen</h1>
            <p className="text-sm text-muted-foreground">
              This becomes your public storefront. You can change it anytime.
            </p>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="px-6">
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="shopName">Shop name</Label>
                <Input
                  id="shopName"
                  placeholder="e.g. Maya's Midnight Bakery"
                  value={shopName}
                  onChange={(e) => handleShopNameChange(e.target.value)}
                  aria-invalid={!!errors.shopName}
                />
                {errors.shopName && (
                  <p className="text-sm text-destructive">{errors.shopName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Storefront address</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    /s/
                  </span>
                  <Input
                    id="slug"
                    placeholder="mayas-bakery"
                    value={slug}
                    onChange={(e) =>
                      setSlug(slugify(e.target.value))
                    }
                    onBlur={() => setSlugTouched(true)}
                    aria-invalid={!!errors.slug}
                    className="flex-1"
                  />
                </div>
                {slugState === "checking" && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Checking availability…
                  </p>
                )}
                {slugState === "available" && (
                  <p className="text-sm text-green-700">
                    Nice — /s/{slug} is available.
                  </p>
                )}
                {slugState === "taken" && (
                  <p className="text-sm text-destructive">
                    /s/{slug} is already taken. Try a different one.
                  </p>
                )}
                {errors.slug && slugState !== "taken" && slugState !== "available" && (
                  <p className="text-sm text-destructive">{errors.slug}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Short bio</Label>
                <Textarea
                  id="bio"
                  placeholder="Tell customers what makes your kitchen special — your style, your story, your signature bakes."
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  aria-invalid={!!errors.bio}
                />
                <p className="text-xs text-muted-foreground">
                  {bio.length}/300 characters
                </p>
                {errors.bio && <p className="text-sm text-destructive">{errors.bio}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pickup">Pickup area</Label>
                  <Input
                    id="pickup"
                    placeholder="e.g. Riverside, Springfield"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    aria-invalid={!!errors.pickupAddress}
                  />
                  {errors.pickupAddress && (
                    <p className="text-sm text-destructive">{errors.pickupAddress}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp">WhatsApp number (optional)</Label>
                <PhoneInput
                  id="whatsapp"
                  value={whatsapp}
                  onChange={setWhatsapp}
                  ariaInvalid={!!errors.whatsapp}
                />
                <p className="text-xs text-muted-foreground">
                  Customers get a “Message the seller” button on your storefront.
                </p>
                {errors.whatsapp && (
                  <p className="text-sm text-destructive">{errors.whatsapp}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full rounded-xl"
                size="lg"
                disabled={submitting || slugState === "checking" || slugState === "taken" || slugState === "invalid"}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Open my storefront
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
