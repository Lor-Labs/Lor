import { createFileRoute } from "@tanstack/react-router"
import { DesignPage } from "@/components/design/design-page"

export const Route = createFileRoute("/design")({
  component: DesignPage,
})
