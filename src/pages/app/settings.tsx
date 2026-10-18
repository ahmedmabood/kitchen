import * as React from "react"
import { Copy, Check, Loader2, Link2, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import { uploadMedia } from "@/lib/storage"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { waLink } from "@/lib/orders"

type ErrorMap = Record<string, string | undefined>

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "PHP", "NGN", "ZAR", "MXN"]

export function SettingsPage() {
  const { seller, refreshSeller } = useAuth()
  const [shopName, setShopName] = React.useState("")
  const [bio, setBio] = React.useState("")
  const [currency, setCurrency] = React.useState("USD")
  const [pickupAddress, setPickupAddress] = React.useState("")
  const [whatsapp, setWhatsapp] = React.useState("")
  const [logoFile, setLogoFile] = React.useState<File | null>(null)
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<ErrorMap>({})
  const [saving, setSaving] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!seller) return
    setShopName(seller.shop_name)
    setBio(seller.bio ?? "")
    setCurrency(seller.currency)
    setPickupAddress(seller.pickup_address ?? "")
    setWhatsapp(seller.whatsapp_number ?? "")
    setLogoPreview(seller.logo_url)
  }, [seller])

  if (!seller)
    return <div className="space-y-4"><Skeleton className="h-64 rounded-2xl" /></div>

  const currentSeller = seller
  const storefrontUrl = `${window.location.origin}/s/${currentSeller.slug}`

  function handleLogo(f: File) {
    if (!f.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, logo: "Please choose an image file (JPG, PNG, or WebP)." }))
      return
    }
    if (f.size > 5 * 1024 * 1024) {
      setErrors((e) => ({ ...e, logo: "Logos need to be under 5 MB." }))
      return
    }
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
    setErrors((e) => ({ ...e, logo: undefined }))
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(storefrontUrl)
      setCopied(true)
      toast.success("Storefront link copied — share it anywhere!")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy the link. Long-press the URL to copy it manually.")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!shopName.trim()) next.shopName = "Your shop needs a name."
    if (bio.length > 300) next.bio = "Keep your bio under 300 characters."
    if (!pickupAddress.trim()) next.pickupAddress = "Tell customers where to pick up."
    if (whatsapp.trim() && validatePhoneE164(whatsapp))
      next.whatsapp = "That WhatsApp number doesn't look right — pick your country and enter the number."
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    try {
      let logo_url = currentSeller.logo_url
      if (logoFile) logo_url = await uploadMedia(logoFile, currentSeller.id, "logos")
      const { error } = await supabase
        .from("sellers")
        .update({
          shop_name: shopName.trim(),
          bio: bio.trim() || null,
          currency,
          pickup_address: pickupAddress.trim(),
          whatsapp_number: whatsapp.trim() || null,
          logo_url,
        })
        .eq("id", currentSeller.id)
      if (error) throw error
      await refreshSeller()
      toast.success("Shop profile saved.")
    } catch {
      toast.error("Couldn't save your profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your shop profile and storefront link.
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">Storefront link</CardTitle>
          <CardDescription>
            Share this on Instagram, WhatsApp, anywhere your customers are.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2.5">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{storefrontUrl}</span>
            </div>
            <Button onClick={handleCopy} className="rounded-xl">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {waLink(currentSeller.whatsapp_number, "Hello!") && (
            <Button asChild variant="outline" className="mt-3 rounded-xl">
              <a
                href={waLink(currentSeller.whatsapp_number, "Hello!")!}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="size-4" /> Preview your WhatsApp button
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">Shop profile</CardTitle>
          <CardDescription>Shown at the top of your public storefront.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label>Shop logo</Label>
              <div className="flex items-center gap-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Shop logo" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                      {shopName.trim().charAt(0) || "?"}
                    </div>
                  )}
                </div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {logoPreview ? "Change logo" : "Upload logo"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleLogo(e.target.files[0])}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">Square works best. Under 5 MB.</p>
                </div>
              </div>
              {errors.logo && <p className="text-sm text-destructive">{errors.logo}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-shop-name">Shop name</Label>
              <Input
                id="settings-shop-name"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                aria-invalid={!!errors.shopName}
              />
              {errors.shopName && <p className="text-sm text-destructive">{errors.shopName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-bio">Short bio</Label>
              <Textarea
                id="settings-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                aria-invalid={!!errors.bio}
              />
              <p className="text-xs text-muted-foreground">{bio.length}/300 characters</p>
              {errors.bio && <p className="text-sm text-destructive">{errors.bio}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full">
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
                <Label htmlFor="settings-pickup">Pickup area</Label>
                <Input
                  id="settings-pickup"
                  value={pickupAddress}
                  onChange={(e) => setPickupAddress(e.target.value)}
                  aria-invalid={!!errors.pickupAddress}
                />
                {errors.pickupAddress && (
                  <p className="text-sm text-destructive">{errors.pickupAddress}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-whatsapp">WhatsApp number</Label>
                <PhoneInput
                  id="settings-whatsapp"
                  value={whatsapp}
                  onChange={setWhatsapp}
                  ariaInvalid={!!errors.whatsapp}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to customers as a “Message the seller” button.
                </p>
                {errors.whatsapp && (
                  <p className="text-sm text-destructive">{errors.whatsapp}</p>
                )}
              </div>
            </div>

            <Button type="submit" className="rounded-xl" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
