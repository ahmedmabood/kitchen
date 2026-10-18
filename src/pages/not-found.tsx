import { Link } from "react-router-dom"
import { Cookie } from "lucide-react"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-secondary">
        <Cookie className="size-8 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          This page seems to have been eaten
        </h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          The page you're looking for doesn't exist. Maybe someone got to it
          before you did.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Back to Batchly</Link>
      </Button>
    </div>
  )
}
