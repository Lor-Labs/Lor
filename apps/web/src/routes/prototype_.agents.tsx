import { createFileRoute, notFound } from "@tanstack/react-router"
import { AgentsPrototype } from "@/components/prototype/agents/agents-prototype"

// Dev only: agents apart from channels, and chats
// (reference/planned/agents-and-chats.md), on made-up data, to judge the
// screens before anything is built.
export const Route = createFileRoute("/prototype_/agents")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: AgentsPrototype,
})
