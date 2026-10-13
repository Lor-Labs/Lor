import { createFileRoute, notFound } from "@tanstack/react-router"
import { DesignPage } from "@/components/design/design-page"

// Dev only: design samples and header variants, kept in case we need them.
export const Route = createFileRoute("/design")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: DesignPage,
})
