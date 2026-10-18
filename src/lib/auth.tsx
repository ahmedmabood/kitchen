import * as React from "react"
import { supabase, type Seller } from "@/lib/supabase"

type AuthState = {
  session: import("@supabase/supabase-js").Session | null
  seller: Seller | null
  loading: boolean
  refreshSeller: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<AuthState["session"]>(null)
  const [seller, setSeller] = React.useState<Seller | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refreshSeller = React.useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setSeller(null)
      return
    }
    const { data } = await supabase
      .from("sellers")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()
    setSeller(data)
  }, [])

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        if (!newSession) setSeller(null)
        else {
          ;(async () => {
            const { data } = await supabase
              .from("sellers")
              .select("*")
              .eq("id", newSession.user.id)
              .maybeSingle()
            setSeller(data)
          })()
        }
        setLoading(false)
      }
    )

    setLoading(false)
    return () => subscription.unsubscribe()
  }, [])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    // Send users back to the landing page instead of leaving them on /auth.
    if (window.location.pathname !== "/") {
      window.location.assign("/")
    }
  }, [])

  const value = React.useMemo(
    () => ({ session, seller, loading, refreshSeller, signOut }),
    [session, seller, loading, refreshSeller, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
