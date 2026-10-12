import { createFileRoute, notFound } from "@tanstack/react-router"
import { SessionsPrototype } from "@/components/prototype/sessions-prototype"

// Dev only: a flow reference for the workspace model, kept in case we need it.
export const Route = createFileRoute("/prototype")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: SessionsPrototype,
})
