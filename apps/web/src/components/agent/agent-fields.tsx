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
import {
  SettingsCard,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { agentCreature, type WorkspaceAgent } from "@/hooks/use-agents"
import type { AgentChanges } from "@/lib/agent-api"

// An agent's profile (reference/agents-and-chats.md): its name, role, face
// and brief. They are the agent's own, so a change shows in every channel
// it is in.

export type AgentDraft = {
  name: string
  creature: CreatureId
  role: string
  brief: string
}

export function agentDraftOf(agent: WorkspaceAgent): AgentDraft {
  return {
    name: agent.name,
    creature: agentCreature(agent),
    role: agent.role ?? "",
    brief: agent.brief ?? "",
  }
}

// Only what the draft changes, so a stale draft never overwrites a field
// someone else saved meanwhile. Null when nothing changed.
export function agentChanges(
  draft: AgentDraft,
  agent: WorkspaceAgent
): AgentChanges | null {
  const name = draft.name.trim()
  const changes: AgentChanges = {
    ...(name && name !== agent.name ? { name } : {}),
    ...(draft.creature !== agent.creature ? { creature: draft.creature } : {}),
    ...(draft.role.trim() !== (agent.role ?? "")
      ? { role: draft.role.trim() || null }
      : {}),
    ...(draft.brief.trim() !== (agent.brief ?? "")
      ? { brief: draft.brief.trim() || null }
      : {}),
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export function AgentProfileFields({
  draft,
  onChange,
  disabled = false,
  briefDisabled = disabled,
  idPrefix,
}: {
  draft: AgentDraft
  onChange: (draft: AgentDraft) => void
  disabled?: boolean
  // The brief takes channel:update; a name and a face, also their maker.
  briefDisabled?: boolean
  idPrefix: string
}) {
  const shownName = draft.name.trim() || "it"
  return (
    <>
      <SettingsCard className="grid gap-4 space-y-0 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={draft.name}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            maxLength={AGENT_NAME_MAX}
            className="bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-role`}>Role</Label>
          <Input
            id={`${idPrefix}-role`}
            value={draft.role}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, role: e.target.value })}
            maxLength={40}
            placeholder="Eng, Support, GTM"
            className="bg-background"
          />
        </div>
      </SettingsCard>

      <SettingsSection title="Face">
        <fieldset
          disabled={disabled}
          className="grid grid-cols-5 gap-1 rounded-xl bg-muted p-2 dark:bg-muted/60"
        >
          <legend className="sr-only">Face</legend>
          {CREATURES.map((creature) => {
            const picked = draft.creature === creature.id
            return (
              <button
                key={creature.id}
                type="button"
                aria-label={creature.label}
                aria-pressed={picked}
                onClick={() => onChange({ ...draft, creature: creature.id })}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1 rounded-lg px-1 pt-2.5 pb-1.5 text-[11px] outline-none transition-[background-color,color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:cursor-default disabled:active:scale-100",
                  picked
                    ? "bg-background text-foreground shadow-xs dark:bg-foreground/10"
                    : "text-muted-foreground enabled:hover:bg-background/60 enabled:hover:text-foreground dark:enabled:hover:bg-foreground/5"
                )}
              >
                <AgentCreature creature={creature.id} size={40} still />
                <span className="truncate">{creature.label}</span>
              </button>
            )
          })}
        </fieldset>
      </SettingsSection>

      <SettingsSection
        title="Brief"
        caption={`Everyone in the workspace can read ${shownName}'s brief. Instructions for one channel go in that channel's settings.`}
      >
        <Textarea
          id={`${idPrefix}-brief`}
          aria-label="Brief"
          value={draft.brief}
          disabled={briefDisabled}
          onChange={(e) => onChange({ ...draft, brief: e.target.value })}
          maxLength={4000}
          rows={5}
          placeholder={`What ${shownName} should know and do, wherever it is. “Watch deploys and tell us in two lines when one fails. Zoe owns the pipeline.”`}
        />
      </SettingsSection>
    </>
  )
}
