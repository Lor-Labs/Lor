import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  type AgentDraft,
  AgentFields,
  agentChanges,
  agentDraftOf,
  createAgent,
  deleteAgent,
  saveAgent,
} from "@/components/agent/agent-fields"
import { AgentFactsList } from "@/components/sidebar/channel-panel/agent-facts-list"
import {
  agentCreature,
  agentsKey,
  useAgents,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

// The workspace's agents (reference/agents-and-chats.md): teammates apart
// from channels. Which channels an agent is in is set on each channel; its
// own settings are edited here or from any channel it is in.

function AgentEditor({
  workspaceSlug,
  agent,
  onDone,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AgentDraft>(() => agentDraftOf(agent))
  const [confirming, setConfirming] = useState(false)
  // A different agent opened in the same slot starts from its own values.
  useEffect(() => {
    setDraft(agentDraftOf(agent))
    setConfirming(false)
  }, [agent.id])
  const changes = agentChanges(draft, agent)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: agentsKey(workspaceSlug) })

  const save = useMutation({
    mutationFn: async () => {
      if (changes) await saveAgent(workspaceSlug, agent.id, changes)
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: () => deleteAgent(workspaceSlug, agent.id),
    onSuccess: async () => {
      await refresh()
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      onDone()
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-3 border-border/70 border-t px-4 py-4">
      <AgentFields
        workspaceSlug={workspaceSlug}
        draft={draft}
        onChange={setDraft}
        idPrefix={`agent-${agent.id}`}
      />
      <AgentFactsList
        workspaceSlug={workspaceSlug}
        agentId={agent.id}
        agentName={agent.name}
      />
      <div className="flex items-center gap-2 pt-1">
        {confirming ? (
          <>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              Delete {agent.name} and its facts? Its channels are left with no
              agent.
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirming(true)}
            >
              Delete agent
            </Button>
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !changes || draft.name.trim().length === 0 || save.isPending
              }
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export function AgentsSection({ workspaceSlug }: { workspaceSlug: string }) {
  const queryClient = useQueryClient()
  const agents = useAgents(workspaceSlug)
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const channelNames = new Map(
    [
      ...(channels?.uncategorized ?? []),
      ...(channels?.categories.flatMap((cat) => cat.channels) ?? []),
    ].map((channel) => [channel.id, channel.name])
  )

  const create = useMutation({
    mutationFn: () => createAgent(workspaceSlug, {}),
    onSuccess: async (made) => {
      await queryClient.invalidateQueries({
        queryKey: agentsKey(workspaceSlug),
      })
      setOpenId(made.id)
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Agents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each agent is a teammate with its own name, brief and memory. Add
            one to a channel from that channel's settings, and it takes all of
            this with it.
          </p>
        </div>
        <Button
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          New agent
        </Button>
      </div>
      {agents.length === 0 ? (
        <p className="rounded-md border border-border/70 border-dashed px-3 py-2 text-sm text-muted-foreground">
          No agents yet. Make one, then add it to the channels it should follow.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
          {agents.map((agent) => {
            const places = agent.channelIds.flatMap(
              (id) => channelNames.get(id) ?? []
            )
            const open = openId === agent.id
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : agent.id)}
                  aria-expanded={open}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[0.03]",
                    open && "bg-foreground/[0.03]"
                  )}
                >
                  <AgentCreature
                    creature={agentCreature(agent)}
                    size={32}
                    still
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {agent.name}
                      {agent.role && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {agent.role}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {places.length > 0
                        ? `In ${places.map((name) => `#${name}`).join(", ")}`
                        : "In no channel"}
                      {agent.accessContainerId && " · Private"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {open ? "Close" : "Edit"}
                  </span>
                </button>
                {open && (
                  <AgentEditor
                    workspaceSlug={workspaceSlug}
                    agent={agent}
                    onDone={() => setOpenId(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
