import {
  BotIcon,
  BubbleChatIcon,
  BubbleChatLockIcon,
  Copy01Icon,
  Folder01Icon,
  PlusSignIcon,
  Settings01Icon,
  Tick02Icon,
  VolumeHighIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { MAX_CHANNEL_AGENTS } from "@repo/db/constants"
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
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { Fragment, useEffect, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { ChannelWebhooksTab } from "@/components/sidebar/channel-panel/channel-webhooks-tab"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import {
  PaneBody,
  PaneDialog,
  PaneFooter,
  type PaneTab,
} from "@/components/ui/pane-dialog"
import {
  SETTINGS_SURFACE,
  SettingsCard,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { useAgentDialog } from "@/hooks/use-agent-dialog"
import { useAgentState } from "@/hooks/use-agent-state"
import {
  agentCreature,
  useAgents,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { useChatArchive } from "@/hooks/use-chat-archive"
import {
  channelAgentsKey,
  loadChannelAgents,
  refreshAgents,
  saveChannelBrief,
  setChannelAgents,
} from "@/lib/agent-api"
import { apiClient } from "@/lib/api-client"
import type { Channel } from "@/lib/api-types"
import {
  patchChannelList,
  restoreChannelList,
  upsertChannel,
} from "@/lib/channel-list-cache"
import { channelQueryOptions } from "@/lib/channel-query"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

export type EditChannelTab = "overview" | "agent" | "webhooks"
type Tab = EditChannelTab

const TABS: PaneTab<Tab>[] = [
  { id: "overview", label: "Overview", icon: Settings01Icon },
  { id: "agent", label: "Agent", icon: BotIcon },
  { id: "webhooks", label: "Webhooks", icon: WebhookIcon },
]

async function errorOf(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

// A channel's settings: its name and topic, the agent in it and its
// webhooks. What an agent may use is the agent's (agent-tools.tsx). The agent's own settings are the
// agent's (agent-dialog.tsx): this only says which agent is here and what
// the team wants from it in this channel.
export function EditChannelDialog({
  channel,
  open,
  onOpenChange,
  overviewOnly = false,
  initialTab = "overview",
}: {
  channel: Channel
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The channel's creator without channel:update: name and topic only. */
  overviewOnly?: boolean
  // The tab it opens on (the channel menu's Agent and Webhooks).
  initialTab?: Tab
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const isCategory = channel.type === "category"
  const isText = channel.type === "text"
  const isPrivate = channel.audience === "members" && channel.parentId === null
  const kind = isCategory ? "category" : "chat"

  // Agents and webhooks are a text channel's.
  const tabs = TABS.filter((item) =>
    item.id === "overview" ? true : overviewOnly ? false : isText
  )
  const [tab, setTab] = useState<Tab>("overview")
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  const shownTab = tabs.some((item) => item.id === tab) ? tab : "overview"

  return (
    <PaneDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${isCategory ? "Category" : "Chat"} settings`}
      description={`Manage this ${kind}'s settings.`}
      identity={
        <div className="flex items-center gap-3 sm:flex-col sm:items-start">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
            {isCategory ? (
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-5"
                strokeWidth={2}
              />
            ) : channel.type === "voice" ? (
              <HugeiconsIcon
                icon={VolumeHighIcon}
                className="size-5"
                strokeWidth={2}
              />
            ) : (
              // A chat, not a "#channel": no hash.
              <HugeiconsIcon
                icon={isPrivate ? BubbleChatLockIcon : BubbleChatIcon}
                className="size-5"
                strokeWidth={2}
              />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-[15px] leading-5">
              {channel.name}
            </div>
            <div className="truncate text-muted-foreground text-xs">
              {isCategory
                ? "Category"
                : isPrivate
                  ? "Private chat"
                  : channel.type === "voice"
                    ? "Voice channel"
                    : "Chat"}
            </div>
          </div>
        </div>
      }
      tabs={tabs}
      tab={shownTab}
      onTabChange={setTab}
      aside={!isCategory && <CopyId channelId={channel.id} />}
    >
      {!workspaceSlug ? null : shownTab === "overview" ? (
        <OverviewTab
          workspaceSlug={workspaceSlug}
          channel={channel}
          open={open}
          onDone={() => onOpenChange(false)}
          // Archiving takes channel:update, like the other tabs here.
          canArchive={isText && !overviewOnly}
        />
      ) : shownTab === "agent" ? (
        <AgentTab
          workspaceSlug={workspaceSlug}
          channel={channel}
          onLeave={() => onOpenChange(false)}
        />
      ) : (
        <PaneBody
          title="Webhooks"
          description={`Events from your other tools, posted in ${channel.name}.`}
        >
          <ChannelWebhooksTab
            workspaceSlug={workspaceSlug}
            channelId={channel.id}
            channelName={channel.name}
          />
        </PaneBody>
      )}
    </PaneDialog>
  )
}

function CopyId({ channelId }: { channelId: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(channelId)
        } catch {
          toast.error("Failed to copy chat ID")
          return
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className="size-3.5"
        strokeWidth={2}
      />
      {copied ? "Copied" : "Copy chat ID"}
    </Button>
  )
}

// Writes a saved channel into the caches that show it.
function useChannelSaved(workspaceSlug: string, channelId: string) {
  const queryClient = useQueryClient()
  return (updated: Channel) => {
    queryClient.setQueryData(
      channelQueryOptions(workspaceSlug, channelId).queryKey,
      updated
    )
    void patchChannelList(queryClient, workspaceSlug, (list) =>
      upsertChannel(list, updated)
    )
  }
}

function OverviewTab({
  workspaceSlug,
  channel,
  open,
  onDone,
  canArchive,
}: {
  workspaceSlug: string
  channel: Channel
  open: boolean
  onDone: () => void
  canArchive: boolean
}) {
  const queryClient = useQueryClient()
  const isCategory = channel.type === "category"
  const kind = isCategory ? "category" : "chat"
  const [name, setName] = useState(channel.name ?? "")
  const [topic, setTopic] = useState(channel.topic ?? "")
  // Drafts start from the channel when the dialog opens or switches channel,
  // not on every cache update, so an unsaved edit survives a rename's
  // optimistic update or its rollback.
  useEffect(() => {
    if (open) {
      setName(channel.name ?? "")
      setTopic(channel.topic ?? "")
    }
  }, [open, channel.id])
  const saved = useChannelSaved(workspaceSlug, channel.id)

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug, channelId: channel.id },
        json: { name, ...(isCategory ? {} : { topic: topic || undefined }) },
      })
      if (!res.ok) throw await errorOf(res, `Failed to update ${kind}`)
      return res.json()
    },
    // The sidebar and the channel header show the new name and topic at
    // once; the server's row replaces them with no refetch, and a failure
    // restores both.
    onMutate: async () => {
      const detailKey = channelQueryOptions(workspaceSlug, channel.id).queryKey
      const change = { name, ...(isCategory ? {} : { topic: topic || null }) }
      await queryClient.cancelQueries({ queryKey: detailKey })
      const previousDetail = queryClient.getQueryData(detailKey)
      queryClient.setQueryData(detailKey, (current) =>
        current ? { ...current, ...change } : current
      )
      const previousList = await patchChannelList(
        queryClient,
        workspaceSlug,
        (list) => upsertChannel(list, { ...channel, ...change })
      )
      return { detailKey, previousDetail, previousList }
    },
    onSuccess: (updated) => {
      saved(updated)
      onDone()
    },
    onError: (error, _vars, context) => {
      if (context) {
        queryClient.setQueryData(context.detailKey, context.previousDetail)
        restoreChannelList(queryClient, workspaceSlug, context.previousList)
      }
      toast.error(error.message)
    },
  })

  const changed =
    name !== (channel.name ?? "") ||
    (!isCategory && topic !== (channel.topic ?? ""))
  const valid = name.trim().length > 0

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed && valid && !save.isPending) save.mutate()
      }}
    >
      <PaneBody title="Overview">
        <SettingsCard>
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              className="bg-background"
            />
          </div>
          {!isCategory && (
            <div className="space-y-2">
              <Label htmlFor="channel-topic">Topic</Label>
              <Textarea
                id="channel-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                maxLength={1024}
                rows={3}
                placeholder="What this chat is for"
              />
              <p className="text-muted-foreground text-xs">
                Shown in the chat's header. The agent in it reads it too.
              </p>
            </div>
          )}
        </SettingsCard>
        {canArchive && (
          <ArchiveChat
            workspaceSlug={workspaceSlug}
            channel={channel}
            onArchived={onDone}
          />
        )}
      </PaneBody>
      <PaneFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!changed || !valid}
          loading={save.isPending}
        >
          Save
        </Button>
      </PaneFooter>
    </form>
  )
}

// Archiving is for everyone (reference/agents-and-chats.md, decision 52),
// so it lives here behind a confirmation; hiding a chat for yourself stays
// in the sidebar.
function ArchiveChat({
  workspaceSlug,
  channel,
  onArchived,
}: {
  workspaceSlug: string
  channel: Channel
  onArchived: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const hasAgents = (channel.agentIds?.length ?? 0) > 0
  const { archive, unarchive } = useChatArchive(workspaceSlug)
  if (channel.archivedAt) {
    return (
      <SettingsSection title="Archive">
        <SettingsCard className="flex items-center justify-between gap-4 space-y-0">
          <p className="min-w-0 text-muted-foreground text-sm">
            Archived for everyone. Unarchiving opens it again and restarts its
            paused loops.
          </p>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            loading={unarchive.isPending}
            onClick={() => unarchive.mutate({ channelId: channel.id })}
          >
            Unarchive
          </Button>
        </SettingsCard>
      </SettingsSection>
    )
  }
  return (
    <SettingsSection title="Archive">
      <SettingsCard className="flex items-center justify-between gap-4 space-y-0">
        <p className="min-w-0 text-muted-foreground text-sm">
          Close this chat for everyone. Its messages are kept.
        </p>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 text-destructive-foreground"
          onClick={() => setConfirming(true)}
        >
          Archive chat
        </Button>
      </SettingsCard>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {channel.name ?? "this chat"} for everyone?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasAgents
                ? "The agents in it stop: they read nothing more here, their loops that report here pause, and events stop posting here. "
                : "Events stop posting here. "}
              It leaves everyone's sidebar and takes no new messages. Its
              messages are kept, and it can be unarchived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { channelId: channel.id, name: channel.name },
                  {
                    onSuccess: () => {
                      setConfirming(false)
                      onArchived()
                    },
                  }
                )
              }
            >
              Archive for everyone
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

// Which agent is in the channel, and what the team wants from it here.
// Adding and removing save at once.
function AgentTab({
  workspaceSlug,
  channel,
  onLeave,
}: {
  workspaceSlug: string
  channel: Channel
  // Closes this dialog before the agent's own opens.
  onLeave: () => void
}) {
  const queryClient = useQueryClient()
  const dialog = useAgentDialog()
  const agents = useAgents(workspaceSlug)
  const saved = useChannelSaved(workspaceSlug, channel.id)
  // A channel can hold several agents (reference/agents-and-chats.md,
  // decision 32), in the order they were added.
  const placed = channel.agentIds.flatMap(
    (id) => agents.find((item) => item.id === id) ?? []
  )
  const others = agents.filter((item) => !placed.includes(item))
  const room = placed.length < MAX_CHANNEL_AGENTS
  const [busy, setBusy] = useState(false)

  const place = async (agentIds: string[]) => {
    setBusy(true)
    try {
      saved(await setChannelAgents(workspaceSlug, channel.id, agentIds))
      await refreshAgents(queryClient, workspaceSlug)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the agent"
      )
      throw error
    } finally {
      setBusy(false)
    }
  }
  const openAgent = (id: string) => {
    onLeave()
    dialog.open(id)
  }

  const add = (
    <SettingsSection title={placed.length > 0 ? "Add another" : "Add an agent"}>
      <SettingsGroup>
        {others.map((item) => (
          <div key={item.id} className="flex min-h-14 items-center gap-3">
            <AgentCreature creature={agentCreature(item)} size={32} still />
            <AgentName agent={item} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void place([...channel.agentIds, item.id]).catch(() => {})
              }
            >
              Add
            </Button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => openAgent("new")}
          className="group flex min-h-14 w-full cursor-pointer items-center gap-3 text-left text-muted-foreground text-sm outline-none transition-colors duration-150 hover:text-foreground focus-visible:text-foreground"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 border-dashed transition-colors duration-150 group-hover:border-foreground/60">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </span>
          New agent
        </button>
      </SettingsGroup>
    </SettingsSection>
  )

  const first = placed[0]
  if (first) {
    return (
      <PaneBody
        title={placed.length > 1 ? "Agents" : "Agent"}
        description={
          placed.length > 1
            ? `${NAMES.format(placed.map((item) => item.name))} read along in ${channel.name}. A mention or a reply wakes the one it names at once.`
            : `${first.name} reads along in ${channel.name}. A mention or a reply wakes it at once.`
        }
      >
        {placed.map((agent) => (
          <Fragment key={agent.id}>
            <PlacedAgent
              workspaceSlug={workspaceSlug}
              channel={channel}
              agent={agent}
              onOpen={() => openAgent(agent.id)}
              onRemove={() =>
                place(channel.agentIds.filter((id) => id !== agent.id))
              }
            />
            <ChannelInstructions
              workspaceSlug={workspaceSlug}
              channel={channel}
              agent={agent}
            />
          </Fragment>
        ))}
        {room && add}
      </PaneBody>
    )
  }
  return (
    <PaneBody
      title="Agent"
      description={`No agent is in ${channel.name}. People talk here and nothing answers.`}
    >
      {add}
    </PaneBody>
  )
}

const NAMES = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

function AgentName({ agent }: { agent: WorkspaceAgent }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium text-sm">{agent.name}</span>
      {agent.role && (
        <span className="block truncate text-muted-foreground text-xs">
          {agent.role}
        </span>
      )}
    </span>
  )
}

function PlacedAgent({
  workspaceSlug,
  channel,
  agent,
  onOpen,
  onRemove,
}: {
  workspaceSlug: string
  channel: Channel
  agent: WorkspaceAgent
  onOpen: () => void
  onRemove: () => Promise<unknown>
}) {
  const state = useAgentState(channel.workspaceId ?? undefined, {
    channelIds: [channel.id],
  })
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const names = new Map(
    [
      ...(list?.uncategorized ?? []),
      ...(list?.categories.flatMap((category) => category.channels) ?? []),
    ].map((item) => [item.id, item.name])
  )
  const elsewhere = agent.channelIds
    .filter((id) => id !== channel.id)
    .flatMap((id) => names.get(id) ?? [])
  return (
    <div className={`${SETTINGS_SURFACE} flex items-center gap-3 p-4`}>
      <AgentCreature creature={agentCreature(agent)} state={state} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">
          {agent.name}
          {agent.role && (
            <span className="ml-2 font-normal text-muted-foreground">
              {agent.role}
            </span>
          )}
        </span>
        <span className="block truncate text-muted-foreground text-xs">
          {elsewhere.length > 0
            ? `Also in ${elsewhere.join(", ")}`
            : "Only in this chat"}
        </span>
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onOpen}>
        Settings
      </Button>
      <InlineConfirmButton
        label={`Remove ${agent.name} from ${channel.name}`}
        confirmLabel="Remove"
        onConfirm={onRemove}
      />
    </div>
  )
}

// What the team wants from the agent in this channel only. Readable by the
// people who can see the channel, so a private channel's instructions stay
// in it; the agent's own brief is everyone's to read.
function ChannelInstructions({
  workspaceSlug,
  channel,
  agent,
}: {
  workspaceSlug: string
  channel: Channel
  agent: WorkspaceAgent
}) {
  const queryClient = useQueryClient()
  const key = channelAgentsKey(workspaceSlug, channel.id)
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => loadChannelAgents(workspaceSlug, channel.id),
  })
  const stored = data?.find((row) => row.agentId === agent.id)?.brief ?? ""
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? stored
  const save = useMutation({
    mutationFn: () =>
      saveChannelBrief(
        workspaceSlug,
        channel.id,
        agent.id,
        text.trim() || null
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key })
      setDraft(null)
    },
    onError: (error) => toast.error(error.message),
  })
  const changed = text.trim() !== stored.trim()
  return (
    <SettingsSection
      title="Instructions for this chat"
      // Always there, so the heading doesn't move when the text changes.
      action={
        <Button
          type="button"
          size="xs"
          loading={save.isPending}
          disabled={!changed}
          aria-hidden={!changed}
          tabIndex={changed ? 0 : -1}
          onClick={() => save.mutate()}
          className={cn(
            "transition-opacity duration-150 ease-out",
            !changed && "pointer-events-none opacity-0 disabled:opacity-0"
          )}
        >
          Save
        </Button>
      }
      caption={`Only the people in ${channel.name} can read these. ${agent.name} follows them here, ahead of its own brief.`}
    >
      <Textarea
        aria-label={`Instructions for ${agent.name} in this chat`}
        value={text}
        disabled={!data}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={4000}
        rows={4}
        placeholder={`What ${agent.name} should do in ${channel.name}. “Only speak up when a deploy fails.”`}
      />
    </SettingsSection>
  )
}
