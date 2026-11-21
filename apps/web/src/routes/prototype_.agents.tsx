import { createFileRoute, notFound } from "@tanstack/react-router"
import { AgentsPrototype } from "@/components/prototype/agents/agents-prototype"

// Dev only: the team-agents direction (reference/planned/team-agents.md,
// LOR-169) on made-up data, to judge the screens before anything is built.
export const Route = createFileRoute("/prototype_/agents")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: AgentsPrototype,
})
