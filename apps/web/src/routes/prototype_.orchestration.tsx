import { createFileRoute, notFound } from "@tanstack/react-router"
import { Orchestration } from "@/components/prototype/agents/orchestration"

// Dev only: a step-through of reference/planned/team-agents.md §5 (LOR-169):
// the thread, the always-on agent and the code sessions, in Lor or in Slack.
export const Route = createFileRoute("/prototype_/orchestration")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: Orchestration,
})
