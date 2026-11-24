import {
  Brain02Icon,
  HashtagIcon,
  Infinity01Icon,
  UserCircleIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { authClient } from "@repo/auth/client"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { agentIdentityFor, type CreatureState } from "@repo/utils/bestiary"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  type AgentDraft,
  AgentProfileFields,
  agentChanges,
  agentDraftOf,
} from "@/components/agent/agent-fields"
import { AgentLoops } from "@/components/agent/agent-loops"
import { AgentRuns } from "@/components/agent/agent-runs"
import { AgentFactsList } from "@/components/sidebar/channel-panel/agent-facts-list"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import {
  PaneBody,
  PaneDialog,
  PaneFooter,
  type PaneTab,
} from "@/components/ui/pane-dialog"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import {
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { type AgentDialogTab, useAgentDialog } from "@/hooks/use-agent-dialog"
import { useAgentState } from "@/hooks/use-agent-state"
import {
  agentCreature,
  useAgents,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import {
  createAgent,
  deleteAgent,
  refreshAgents,
  saveAgent,
  setChannelAgents,
} from "@/lib/agent-api"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

const TABS: PaneTab<AgentDialogTab>[] = [
  { id: "profile", label: "Profile", icon: UserCircleIcon },
  { id: "memory", label: "Memory", icon: Brain02Icon },
  { id: "channels", label: "Channels", icon: HashtagIcon },
  { id: "loops", label: "Loops", icon: Infinity01Icon },
  { id: "runs", label: "Runs", icon: ZapIcon },
]

const STATE_TEXT: Record<CreatureState, string> = {
  asleep: "Resting",
  idle: "Here",
  working: "Working",
  needs_you: "Waiting on you",
}

// Who the dialog is about, above its sections. The face is the draft's, so
// picking another one shows at once.
function Identity({
  draft,
  state,
  caption,
}: {
  draft: Pick<AgentDraft, "name" | "creature" | "role">
  state: CreatureState
  caption?: string
}) {
  return (
    <div className="flex items-center gap-3 sm:flex-col sm:items-start">
      <AgentCreature creature={draft.creature} state={state} size={48} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-[15px] leading-5">
          {draft.name.trim() || "New agent"}
        </div>
        <div className="truncate text-muted-foreground text-xs">
          {caption ?? (draft.role.trim() || "Agent")}
        </div>
      </div>
    </div>
  )
}

// Mounted once per workspace. Anything opens an agent with useAgentDialog.
export function AgentDialogHost({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string
  workspaceId: string
}) {
  const { agentId, close } = useAgentDialog()
  const agents = useAgents(workspaceSlug)
  // Kept after close, so the dialog's content stays while it fades out.
  const [shown, setShown] = useState(agentId)
  useEffect(() => {
    if (agentId) setShown(agentId)
  }, [agentId])
  const agent = agents.find((item) => item.id === shown)
  const open = Boolean(agentId)
  const onOpenChange = (next: boolean) => {
    if (!next) close()
  }
  if (shown === "new") {
    return (
      <NewAgentDialog
        workspaceSlug={workspaceSlug}
        open={open && agentId === "new"}
        onOpenChange={onOpenChange}
      />
    )
  }
  if (!agent) return null
  return (
    <AgentDialog
      key={agent.id}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      agent={agent}
      open={open && agentId === agent.id}
      onOpenChange={onOpenChange}
    />
  )
}

function AgentDialog({
  workspaceSlug,
  workspaceId,
  agent,
  open,
  onOpenChange,
}: {
  workspaceSlug: string
  workspaceId: string
  agent: WorkspaceAgent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { tab, setTab } = useAgentDialog()
  const { data: session } = authClient.useSession()
  const canManage = useCanManageChannels(workspaceSlug)
  // Without channel:update, the person who made it may still name it.
  const canEditIdentity = canManage || agent.createdById === session?.user.id
  const state = useAgentState(workspaceId, agent)
  const [draft, setDraft] = useState<AgentDraft>(() => agentDraftOf(agent))
  const [deleting, setDeleting] = useState(false)
  const changes = agentChanges(draft, agent)
  const valid = draft.name.trim().length > 0

  const save = useMutation({
    mutationFn: async () => {
      if (!changes) return agent
      return saveAgent(workspaceSlug, agent.id, changes)
    },
    onSuccess: async (saved) => {
      await refreshAgents(queryClient, workspaceSlug)
      // The server cleans a name (it loses "@" and the like).
      setDraft(agentDraftOf(saved))
    },
    onError: (error) => toast.error(error.message),
  })

  const shownTab = TABS.some((item) => item.id === tab) ? tab : "profile"

  return (
    <>
      <PaneDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`${agent.name}'s settings`}
        description="This agent's profile, memory, channels, loops and how it runs."
        identity={
          <Identity
            draft={draft}
            state={state}
            caption={
              state === "asleep"
                ? draft.role.trim() || "Agent"
                : STATE_TEXT[state]
            }
          />
        }
        tabs={TABS}
        tab={shownTab}
        onTabChange={setTab}
        aside={
          canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-destructive-foreground"
              onClick={() => setDeleting(true)}
            >
              Delete agent
            </Button>
          )
        }
      >
        {shownTab === "profile" ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              if (changes && valid && !save.isPending) save.mutate()
            }}
          >
            <PaneBody
              title="Profile"
              description={`Who ${agent.name} is, in every channel it is in.`}
            >
              <AgentProfileFields
                draft={draft}
                onChange={setDraft}
                disabled={!canEditIdentity}
                briefDisabled={!canManage}
                idPrefix={`agent-${agent.id}`}
              />
            </PaneBody>
            {canEditIdentity && (
              <PaneFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!changes || save.isPending}
                  onClick={() => setDraft(agentDraftOf(agent))}
                >
                  Discard
                </Button>
                <Button
                  type="submit"
                  disabled={!changes || !valid}
                  loading={save.isPending}
                >
                  Save
                </Button>
              </PaneFooter>
            )}
          </form>
        ) : shownTab === "memory" ? (
          <PaneBody
            title="Memory"
            description={`What ${agent.name} keeps after its turns and has in front of it on every one. Anyone can correct or delete a fact.`}
          >
            <AgentFactsList
              workspaceSlug={workspaceSlug}
              agentId={agent.id}
              agentName={agent.name}
            />
          </PaneBody>
        ) : shownTab === "channels" ? (
          <PaneBody
            title="Channels"
            description={`Where ${agent.name} reads along. A mention or a reply wakes it at once; it catches up on the rest at its check-in.`}
          >
            <AgentChannels
              workspaceSlug={workspaceSlug}
              agent={agent}
              canManage={canManage}
            />
          </PaneBody>
        ) : shownTab === "loops" ? (
          <PaneBody
            title="Loops"
            description={`What ${agent.name} does on a schedule. A loop runs in the channel it was set up in.`}
          >
            <AgentLoops workspaceSlug={workspaceSlug} agent={agent} />
          </PaneBody>
        ) : (
          <PaneBody
            title="Runs"
            description={`What ${agent.name} runs on, and who pays for it.`}
          >
            <AgentRuns
              workspaceSlug={workspaceSlug}
              agent={agent}
              canManage={canManage}
            />
          </PaneBody>
        )}
      </PaneDialog>
      <DeleteAgentDialog
        workspaceSlug={workspaceSlug}
        agent={agent}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => onOpenChange(false)}
      />
    </>
  )
}

function ChannelName({
  name,
  isPrivate,
}: {
  name: string | null
  isPrivate: boolean
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {isPrivate ? (
          <PrivateHashIcon className="size-3.5" strokeWidth={2} />
        ) : (
          "#"
        )}
      </span>
      <span className="truncate">{name ?? "channel"}</span>
    </span>
  )
}

// The channels an agent is in, and the others it could join. Any agent can
// be in any channel: what it learns in a private one stays there.
function AgentChannels({
  workspaceSlug,
  agent,
  canManage,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const agents = useAgents(workspaceSlug)
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const privateCategories = new Set(
    (list?.categories ?? [])
      .filter((category) => category.audience === "members")
      .map((category) => category.id)
  )
  const channels = list ? openTextChannels(list) : []
  const [busy, setBusy] = useState<string | null>(null)

  const place = async (channelId: string, agentIds: string[]) => {
    setBusy(channelId)
    try {
      await setChannelAgents(workspaceSlug, channelId, agentIds)
      await refreshAgents(queryClient, workspaceSlug)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the channel"
      )
      throw error
    } finally {
      setBusy(null)
    }
  }

  if (!list) {
    return <p className="px-4 text-muted-foreground text-sm">Loading…</p>
  }
  if (channels.length === 0) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground text-sm dark:bg-muted/60">
        No channels yet.
      </p>
    )
  }
  const isPrivate = (channel: (typeof channels)[number]) =>
    channel.audience === "members" ||
    (channel.parentId !== null && privateCategories.has(channel.parentId))
  const inChannels = channels.filter((channel) =>
    channel.agentIds.includes(agent.id)
  )
  const others = channels.filter(
    (channel) => !channel.agentIds.includes(agent.id)
  )
  return (
    <>
      <SettingsSection title={`${agent.name} is in`} count={inChannels.length}>
        {inChannels.length === 0 ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground text-sm dark:bg-muted/60">
            No channel yet. {agent.name} answers nowhere until it is in one.
          </p>
        ) : (
          <SettingsGroup>
            {inChannels.map((channel) => (
              <div
                key={channel.id}
                className="flex min-h-12 items-center gap-3"
              >
                <ChannelName
                  name={channel.name}
                  isPrivate={isPrivate(channel)}
                />
                {canManage && (
                  <InlineConfirmButton
                    label={`Remove ${agent.name} from #${channel.name}`}
                    confirmLabel="Remove"
                    onConfirm={() => place(channel.id, [])}
                  />
                )}
              </div>
            ))}
          </SettingsGroup>
        )}
      </SettingsSection>
      {canManage && others.length > 0 && (
        <SettingsSection
          title="Add to"
          caption="A channel holds one agent for now. What an agent learns in a private channel stays in it."
        >
          <SettingsGroup>
            {others.map((channel) => {
              const other =
                agents.find((item) => item.id === channel.agentIds[0]) ?? null
              return (
                <div
                  key={channel.id}
                  className="flex min-h-12 items-center gap-3"
                >
                  <ChannelName
                    name={channel.name}
                    isPrivate={isPrivate(channel)}
                  />
                  {other && (
                    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                      <AgentCreature
                        creature={agentCreature(other)}
                        size={18}
                        still
                      />
                      {other.name} is here
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={other ? "ghost" : "outline"}
                    disabled={busy === channel.id}
                    onClick={() =>
                      void place(channel.id, [agent.id]).catch(() => {})
                    }
                  >
                    {other ? "Replace" : "Add"}
                  </Button>
                </div>
              )
            })}
          </SettingsGroup>
        </SettingsSection>
      )}
    </>
  )
}

function DeleteAgentDialog({
  workspaceSlug,
  agent,
  open,
  onOpenChange,
  onDeleted,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteAgent(workspaceSlug, agent.id),
    onSuccess: async () => {
      onOpenChange(false)
      onDeleted()
      await refreshAgents(queryClient, workspaceSlug)
    },
    onError: (error) => toast.error(error.message),
  })
  const count = agent.channelIds.length
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {agent.name}'s brief and everything it remembers are deleted for
            good.{" "}
            {count > 0
              ? `The ${count === 1 ? "channel it is in is" : `${count} channels it is in are`} left with no agent.`
              : "It is in no channel."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => remove.mutate()}
            loading={remove.isPending}
          >
            Delete agent
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const NEW_TABS: PaneTab<"profile">[] = [
  { id: "profile", label: "Profile", icon: UserCircleIcon },
]

// A name and a face to start from, new each time the dialog opens.
function newDraft(): AgentDraft {
  return { ...agentIdentityFor(crypto.randomUUID()), role: "", brief: "" }
}

// Nothing is made until Create: the draft is only a suggestion.
function NewAgentDialog({
  workspaceSlug,
  open,
  onOpenChange,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const dialog = useAgentDialog()
  const [draft, setDraft] = useState<AgentDraft>(newDraft)
  useEffect(() => {
    if (open) setDraft(newDraft())
  }, [open])
  const valid = draft.name.trim().length > 0
  const create = useMutation({
    mutationFn: () =>
      createAgent(workspaceSlug, {
        name: draft.name.trim(),
        creature: draft.creature,
        role: draft.role.trim() || null,
        brief: draft.brief.trim() || null,
      }),
    onSuccess: async (made) => {
      await refreshAgents(queryClient, workspaceSlug)
      // Next: put it somewhere.
      dialog.open(made.id, "channels")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <PaneDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New agent"
      description="Name a new agent and write its brief."
      identity={<Identity draft={draft} state="idle" caption="New agent" />}
      tabs={NEW_TABS}
      tab="profile"
      onTabChange={() => {}}
      aside={
        <p className="px-2 text-pretty text-muted-foreground text-xs">
          Its memory, channels and runs come once it exists.
        </p>
      }
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid && !create.isPending) create.mutate()
        }}
      >
        <PaneBody
          title="New agent"
          description="A teammate with its own name, brief and memory. You add it to channels next."
        >
          <AgentProfileFields
            draft={draft}
            onChange={setDraft}
            idPrefix="new-agent"
          />
        </PaneBody>
        <PaneFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={create.isPending}>
            Create agent
          </Button>
        </PaneFooter>
      </form>
    </PaneDialog>
  )
}
