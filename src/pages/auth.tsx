import * as React from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { ChefHat, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthPage() {
  const { session, seller, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = React.useState<"signup" | "login">("signup")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [errors, setErrors] = React.useState<{
    email?: string
    password?: string
    form?: string
  }>({})
  const [submitting, setSubmitting] = React.useState(false)

  if (loading) return null
  if (session) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from
    return <Navigate to={seller ? from?.pathname ?? "/app/orders" : "/onboarding"} replace />
  }

  function validate() {
    const next: typeof errors = {}
    if (!email.trim()) next.email = "Enter your email address."
    else if (!EMAIL_RE.test(email.trim())) next.email = "That doesn't look like a valid email address."
    if (!password) next.password = "Enter a password."
    else if (mode === "signup" && password.length < 6)
      next.password = "Passwords need at least 6 characters."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setErrors({})

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) {
        setErrors({
          form:
            error.message === "User already registered"
              ? "An account with this email already exists. Try logging in instead."
              : error.message,
        })
        setSubmitting(false)
        return
      }
      toast.success("Welcome to Batchly! Let's set up your kitchen.")
      navigate("/onboarding", { replace: true })
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) {
        setErrors({
          form:
            error.message === "Invalid login credentials"
              ? "Email or password is incorrect. Please try again."
              : error.message,
        })
        setSubmitting(false)
        return
      }
      navigate("/app/orders", { replace: true })
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ChefHat className="size-7" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Batchly</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Pre-order storefronts for home kitchens.
            </p>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="px-6">
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("signup")
                  setErrors({})
                }}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  mode === "signup"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Create account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("login")
                  setErrors({})
                }}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  mode === "login"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Log in
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!errors.password}
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password}</p>
                )}
              </div>
              {errors.form && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errors.form}
                </p>
              )}
              <Button type="submit" className="w-full rounded-xl" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {mode === "signup" ? "Create my kitchen" : "Log in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sell cupcakes, sourdough, weeknight dinners — anything you cook in
          limited batches. Your customers pre-order, you bake the right amount.
        </p>
      </div>
    </div>
  )
}
