import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Textarea } from "@repo/ui/components/textarea"
import { cn } from "@repo/ui/lib/utils"
import {
  AGENT_NAME_MAX,
  CREATURES,
  type CreatureId,
} from "@repo/utils/bestiary"
import { AgentCreature } from "@/components/agent/agent-creature"
import { AgentModelSelect } from "@/components/sidebar/channel-panel/agent-model-select"
import { agentCreature, type WorkspaceAgent } from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"

// An agent's own settings (reference/agents-and-chats.md): its name, face,
// role, model and brief. They are the agent's, so a change shows in every
// channel it is in.

export type AgentDraft = {
  name: string
  creature: CreatureId
  role: string
  model: string | null
  brief: string
}

export function agentDraftOf(agent: WorkspaceAgent): AgentDraft {
  return {
    name: agent.name,
    creature: agentCreature(agent),
    role: agent.role ?? "",
    model: agent.model,
    brief: agent.brief ?? "",
  }
}

// Only what the draft changes, so a stale draft never overwrites a field
// someone else saved meanwhile. Null when nothing changed or the name is
// blank.
export function agentChanges(draft: AgentDraft, agent: WorkspaceAgent) {
  const name = draft.name.trim()
  const changes = {
    ...(name && name !== agent.name ? { name } : {}),
    ...(draft.creature !== agent.creature ? { creature: draft.creature } : {}),
    ...(draft.role.trim() !== (agent.role ?? "")
      ? { role: draft.role.trim() || null }
      : {}),
    ...(draft.model !== agent.model ? { model: draft.model } : {}),
    ...(draft.brief.trim() !== (agent.brief ?? "")
      ? { brief: draft.brief.trim() || null }
      : {}),
  }
  return Object.keys(changes).length > 0 ? changes : null
}

async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

export async function saveAgent(
  workspaceSlug: string,
  agentId: string,
  changes: NonNullable<ReturnType<typeof agentChanges>>
): Promise<WorkspaceAgent> {
  const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
    ":agentId"
  ].$patch({ param: { workspaceSlug, agentId }, json: changes })
  if (!res.ok) throw await failure(res, "Failed to save the agent")
  return res.json()
}

export async function createAgent(
  workspaceSlug: string,
  input: { accessContainerId?: string | null; role?: string | null }
): Promise<WorkspaceAgent> {
  const res = await apiClient.v1.workspaces[":workspaceSlug"].agents.$post({
    param: { workspaceSlug },
    json: input,
  })
  if (!res.ok) throw await failure(res, "Failed to make the agent")
  return res.json()
}

export async function deleteAgent(workspaceSlug: string, agentId: string) {
  const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
    ":agentId"
  ].$delete({ param: { workspaceSlug, agentId } })
  if (!res.ok) throw await failure(res, "Failed to delete the agent")
}

export function AgentFields({
  workspaceSlug,
  draft,
  onChange,
  appearanceOnly = false,
  idPrefix = "agent",
}: {
  workspaceSlug: string
  draft: AgentDraft
  onChange: (draft: AgentDraft) => void
  // The person who made the agent, without channel:update: how it appears.
  appearanceOnly?: boolean
  idPrefix?: string
}) {
  const shownName = draft.name.trim() || "it"
  return (
    <>
      <div className="flex gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <AgentCreature
            creature={draft.creature}
            size={72}
            label={draft.name}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            maxLength={AGENT_NAME_MAX}
          />
          <Label htmlFor={`${idPrefix}-role`}>Role</Label>
          <Input
            id={`${idPrefix}-role`}
            value={draft.role}
            onChange={(e) => onChange({ ...draft, role: e.target.value })}
            maxLength={40}
            placeholder="What it looks after, like Eng or Support"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Creature</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {CREATURES.map((creature) => (
            <button
              key={creature.id}
              type="button"
              title={creature.label}
              aria-label={creature.label}
              aria-pressed={draft.creature === creature.id}
              onClick={() => onChange({ ...draft, creature: creature.id })}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-0.5 rounded-md border px-1 pt-1.5 pb-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60",
                draft.creature === creature.id
                  ? "border-primary bg-accent text-foreground"
                  : "border-transparent"
              )}
            >
              <AgentCreature creature={creature.id} size={48} still />
              <span className="truncate">{creature.label}</span>
            </button>
          ))}
        </div>
      </div>
      {!appearanceOnly && (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-model`}>Model</Label>
            <AgentModelSelect
              id={`${idPrefix}-model`}
              workspaceSlug={workspaceSlug}
              value={draft.model}
              onChange={(model) => onChange({ ...draft, model })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-brief`}>Brief</Label>
            <Textarea
              id={`${idPrefix}-brief`}
              value={draft.brief}
              onChange={(e) => onChange({ ...draft, brief: e.target.value })}
              maxLength={4000}
              rows={4}
              placeholder={`What ${shownName} should know and do, e.g. “Watch deploys and tell us in two lines when one fails. Zoe owns the pipeline.”`}
            />
            <p className="text-xs text-muted-foreground">
              Standing instructions for {shownName}, wherever it is. Only people
              write the brief.
            </p>
          </div>
        </>
      )}
    </>
  )
}
