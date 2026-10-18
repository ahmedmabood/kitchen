import * as React from "react"
import { Plus, Pencil, Eye, EyeOff, Trash2, CupSoda, ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { supabase, type Product } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import { uploadMedia } from "@/lib/storage"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, EmptyContent } from "@/components/ui/empty"

type ErrorMap = Record<string, string | undefined>

export function ProductsPage() {
  const { seller } = useAuth()
  const [products, setProducts] = React.useState<Product[] | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Product | null>(null)
  const [deleting, setDeleting] = React.useState<Product | null>(null)

  async function load() {
    if (!seller) return
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("seller_id", seller.id)
      .order("created_at", { ascending: true })
    if (error) {
      toast.error("Couldn't load your products. Please refresh.")
      setProducts([])
      return
    }
    setProducts(data)
  }

  React.useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seller?.id])

  async function toggleActive(p: Product) {
    const { error } = await supabase
      .from("products")
      .update({ active: !p.active })
      .eq("id", p.id)
    if (error) {
      toast.error("Couldn't update the product. Please try again.")
      return
    }
    setProducts((prev) =>
      prev ? prev.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)) : prev
    )
    toast.success(p.active ? "Product hidden from your storefront." : "Product is visible again.")
  }

  async function handleDelete() {
    if (!deleting) return
    const { error } = await supabase.from("products").delete().eq("id", deleting.id)
    if (error) {
      toast.error(
        "Couldn't delete this product — it may be part of a batch. Try hiding it instead."
      )
      setDeleting(null)
      return
    }
    setProducts((prev) => (prev ? prev.filter((x) => x.id !== deleting.id) : prev))
    toast.success(`Deleted "${deleting.name}".`)
    setDeleting(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you can put in a batch — bakes, meals, drinks.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="rounded-xl"
        >
          <Plus className="size-4" /> Add product
        </Button>
      </div>

      {products === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <Empty className="rounded-2xl border-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CupSoda />
            </EmptyMedia>
            <EmptyTitle>No products yet</EmptyTitle>
            <EmptyDescription>
              Add your first product — like "Brown Butter Chocolate Chip Cookies,
              box of 6" — and it'll be ready to drop into a batch.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              className="rounded-xl"
            >
              <Plus className="size-4" /> Add your first product
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              currency={seller?.currency ?? "USD"}
              onEdit={() => {
                setEditing(p)
                setDialogOpen(true)
              }}
              onToggle={() => toggleActive(p)}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={(saved) => {
          setProducts((prev) => {
            if (!prev) return [saved]
            const exists = prev.some((x) => x.id === saved.id)
            return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]
          })
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the product for good. If it's already in a batch, you'll
              need to hide it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProductCard({
  product,
  currency,
  onEdit,
  onToggle,
  onDelete,
}: {
  product: Product
  currency: string
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex gap-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <CupSoda className="size-7 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold leading-snug">{product.name}</h3>
            <p className="mt-0.5 text-sm font-medium text-primary">
              {formatMoney(Number(product.price), currency)}
            </p>
          </div>
          <Badge variant={product.active ? "default" : "secondary"}>
            {product.active ? "Visible" : "Hidden"}
          </Badge>
        </div>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {product.description}
          </p>
        )}
        <div className="mt-auto flex gap-1 pt-2">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit product">
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-label={product.active ? "Hide product" : "Show product"}
          >
            {product.active ? <EyeOff /> : <Eye />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Delete product"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProductDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Product | null
  onSaved: (p: Product) => void
}) {
  const { seller } = useAuth()
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [imageFile, setImageFile] = React.useState<File | null>(null)
  const [imagePreview, setImagePreview] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<ErrorMap>({})

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? "")
      setDescription(editing?.description ?? "")
      setPrice(editing ? String(editing.price) : "")
      setImageFile(null)
      setImagePreview(editing?.image_url ?? null)
      setErrors({})
    }
  }, [open, editing])

  function handleFile(f: File) {
    if (!f.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, image: "Please choose an image file (JPG, PNG, or WebP)." }))
      return
    }
    if (f.size > 5 * 1024 * 1024) {
      setErrors((e) => ({ ...e, image: "Images need to be under 5 MB." }))
      return
    }
    setImageFile(f)
    setImagePreview(URL.createObjectURL(f))
    setErrors((e) => ({ ...e, image: undefined }))
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = "Give the product a name."
    const num = Number(price)
    if (!price.trim()) next.price = "Set a price."
    else if (Number.isNaN(num) || num < 0) next.price = "Enter a valid price, like 12.50."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !seller) return
    setSaving(true)
    try {
      let image_url = editing?.image_url ?? null
      if (imageFile) {
        setUploading(true)
        image_url = await uploadMedia(imageFile, seller.id, "products")
        setUploading(false)
      }
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        price: Number(price),
        image_url,
      }
      if (editing) {
        const { data, error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", editing.id)
          .select()
          .single()
        if (error) throw error
        onSaved(data)
        toast.success("Product updated.")
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        onSaved(data)
        toast.success(`"${payload.name}" added. Ready for a batch!`)
      }
      onOpenChange(false)
    } catch {
      toast.error("Something went wrong saving the product. Please try again.")
    } finally {
      setSaving(false)
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "Add a product"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the details — changes show on your storefront immediately."
              : "What are you baking or cooking? You'll set units per batch later."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>Photo</Label>
            {imagePreview ? (
              <div className="relative w-fit">
                <img
                  src={imagePreview}
                  alt="Product preview"
                  className="size-28 rounded-xl object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null)
                    setImagePreview(null)
                    if (fileInputRef.current) fileInputRef.current.value = ""
                  }}
                  className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow"
                  aria-label="Remove photo"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent/50"
              >
                {uploading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <>
                    <ImagePlus className="size-5" />
                    <span>Upload a photo (makes batches look great)</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {errors.image && <p className="text-sm text-destructive">{errors.image}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-name">Name</Label>
            <Input
              id="product-name"
              placeholder="e.g. Brown Butter Cookie Box (6)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-desc">Description</Label>
            <Textarea
              id="product-desc"
              placeholder="What's inside? Allergens? What makes it special?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-price">Price ({seller?.currency ?? "USD"})</Label>
            <Input
              id="product-price"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="12.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={!!errors.price}
            />
            {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
          </div>

          <Button type="submit" className="w-full rounded-xl" disabled={saving}>
            {(saving || uploading) && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : "Add product"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
