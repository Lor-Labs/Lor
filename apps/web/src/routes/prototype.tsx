import { createFileRoute } from "@tanstack/react-router"
import { SessionsPrototype } from "@/components/prototype/sessions-prototype"

export const Route = createFileRoute("/prototype")({
  component: SessionsPrototype,
})
