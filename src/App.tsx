import * as React from "react"
import { Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/lib/auth"
import { Spinner } from "@/components/ui/spinner"
import { AuthPage } from "@/pages/auth"
import { OnboardingPage } from "@/pages/onboarding"
import { AppLayout } from "@/pages/app/layout"
import { OrdersPage } from "@/pages/app/orders"
import { BatchesPage } from "@/pages/app/batches"
import { ProductsPage } from "@/pages/app/products"
import { SettingsPage } from "@/pages/app/settings"
import { StorefrontPage } from "@/pages/storefront"
import { OrderConfirmationPage } from "@/pages/order-confirmation"
import { ClaimPage } from "@/pages/claim"
import { NotFoundPage } from "@/pages/not-found"
import { LandingPage } from "@/pages/landing"
import { LazyGsap } from "@/lib/gsap"

function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Spinner className="size-6 text-primary" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, seller, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader />
  if (!session) return <Navigate to="/auth" state={{ from: location }} replace />
  if (!seller) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function LandingRoute() {
  const { loading } = useAuth()
  if (loading) return <FullPageLoader />
  return <LandingPage />
}

export default function App() {
  React.useEffect(() => {
    LazyGsap.init()
  }, [])

  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/orders" replace />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="batches" element={<BatchesPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/s/:slug" element={<StorefrontPage />} />
      <Route path="/order/:code" element={<OrderConfirmationPage />} />
      <Route path="/claim/:code" element={<ClaimPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
