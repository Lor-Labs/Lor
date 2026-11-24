import { useNavigate, useSearch } from "@tanstack/react-router"
import { useCallback } from "react"

export type AgentDialogTab = "profile" | "memory" | "channels" | "runs"

// The agent dialog is URL-driven like the settings dialogs, so anything can
// open it and a link to an agent's settings works: ?agent=<id|new>&agentTab=.
export function useAgentDialog() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const agentId = search.agent as string | undefined
  const tab = (search.agentTab as AgentDialogTab | undefined) ?? "profile"

  const open = useCallback(
    (id: string, nextTab?: AgentDialogTab) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, agent: id, agentTab: nextTab }),
      }),
    [navigate]
  )
  const close = useCallback(
    () =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, agent: undefined, agentTab: undefined }),
      }),
    [navigate]
  )
  const setTab = useCallback(
    (nextTab: AgentDialogTab) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, agentTab: nextTab }),
        replace: true,
      }),
    [navigate]
  )
  return { agentId, tab, open, close, setTab }
}
