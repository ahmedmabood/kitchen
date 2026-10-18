import { NavLink, Outlet, Link } from "react-router-dom"
import { ChefHat, LogOut, Package, CalendarDays, Settings, ExternalLink, ClipboardList, RotateCcw, Loader2, FlaskConical, Home } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth"
import { resetDemoData } from "@/lib/orders"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/app/orders", label: "Orders", icon: ClipboardList },
  { to: "/app/batches", label: "Batches", icon: CalendarDays },
  { to: "/app/products", label: "Products", icon: Package },
  { to: "/app/settings", label: "Settings", icon: Settings },
]

export function AppLayout() {
  const { seller, signOut } = useAuth()
  const isDemo = seller?.demo_locked === true
  const [resetting, setResetting] = React.useState(false)

  async function handleReset() {
    setResetting(true)
    const ok = await resetDemoData()
    setResetting(false)
    if (ok) {
      toast.success("Demo data reset — the batch, units and orders are back to their original state.")
      window.location.reload()
    } else {
      toast.error("Couldn't reset the demo data. Please try again.")
    }
  }

  const navItems = NAV_ITEMS.filter((item) => !(isDemo && item.to === "/app/settings"))

  return (
    <div className="flex min-h-svh bg-background">
      {/* Demo banner */}
      {isDemo && (
        <div className="fixed inset-x-0 top-0 z-50 border-b bg-primary px-4 py-2 text-primary-foreground md:left-60">
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <FlaskConical className="size-4" /> You're viewing the demo seller account
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="rounded-lg" disabled={resetting} onClick={handleReset}>
                {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Reset demo data
              </Button>
              <Button size="sm" variant="ghost" className="rounded-lg text-primary-foreground hover:bg-primary-foreground/10" onClick={() => signOut()}>
                Log out
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat className="size-5" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">Batchly</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t px-3 py-3">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <Home className="size-4" />
            Home
          </Link>
          {seller && (
            <Link
              to={`/s/${seller.slug}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              <ExternalLink className="size-4" />
              View storefront
            </Link>
          )}
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 pt-10 md:pb-0 md:pt-10">
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChefHat className="size-4" />
            </div>
            <span className="font-display text-base font-semibold">Batchly</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                {seller?.shop_name ?? "Account"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{seller?.shop_name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/">Home</Link>
              </DropdownMenuItem>
              {seller && (
                <DropdownMenuItem asChild>
                  <Link to={`/s/${seller.slug}`}>View storefront</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => signOut()}>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mx-auto w-full max-w-4xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )
            }
          >
            <item.icon className="size-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
