import {
  Copy01Icon,
  Layers01Icon,
  Settings01Icon,
  Tick02Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  type AgentDraft,
  AgentFields,
  agentChanges,
  agentDraftOf,
  createAgent,
  saveAgent,
} from "@/components/agent/agent-fields"
import { DiscordChatSection } from "@/components/agent/discord-chat-section"
import { AgentFactsList } from "@/components/sidebar/channel-panel/agent-facts-list"
import { ChannelWebhooksTab } from "@/components/sidebar/channel-panel/channel-webhooks-tab"
import { MorphText } from "@/components/ui/morph-text"
import { GrantedChips } from "@/components/workspace/agent-profiles-section"
import { agentsKey, useAgents } from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AgentProfilesResponse,
  Channel,
} from "@/lib/api-types"
import {
  patchChannelList,
  restoreChannelList,
  upsertChannel,
} from "@/lib/channel-list-cache"
import { channelQueryOptions } from "@/lib/channel-query"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

const INHERIT = "__inherit__"
const NO_AGENT = "__none__"

export type EditChannelTab = "overview" | "profile" | "webhooks"
type Tab = EditChannelTab
const TABS: { id: Tab; label: string; icon: IconSvgElement }[] = [
  { id: "overview", label: "Overview", icon: Settings01Icon },
  { id: "profile", label: "Agent", icon: Layers01Icon },
  { id: "webhooks", label: "Webhooks", icon: WebhookIcon },
]

function ProfileCapabilities({
  profile,
  groups,
}: {
  profile: AgentProfile
  groups: AgentProfilesResponse["availableToolGroups"]
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">
        Lor can use
      </div>
      <GrantedChips profile={profile} groups={groups} />
    </div>
  )
}

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
  // The tab it opens on (the channel menu's Agent Settings and Webhooks).
  initialTab?: Tab
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const isCategory = channel.type === "category"

  const [tab, setTab] = useState<Tab>("overview")
  const [idCopied, setIdCopied] = useState(false)
  const [name, setName] = useState(channel.name ?? "")
  const [topic, setTopic] = useState(channel.topic ?? "")
  const [profileId, setProfileId] = useState(channel.agentProfileId ?? INHERIT)
  // Which agent is in the channel (reference/agents-and-chats.md), and a
  // draft of that agent's own settings. Both save with the dialog.
  const [agentId, setAgentId] = useState<string | null>(channel.agentId)
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null)
  const agents = useAgents(workspaceSlug)
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null
  const { data: session } = authClient.useSession()
  const { data: channelList } = useQuery({
    ...workspaceChannelsQueryOptions(workspaceSlug ?? ""),
    enabled: open && !!workspaceSlug,
  })

  // Drafts start from the channel when the dialog opens or switches channel,
  // not on every cache update, so an unsaved edit survives a rename's
  // optimistic update or its rollback.
  useEffect(() => {
    if (open) {
      setTab(
        overviewOnly && !(initialTab === "profile" && channel.type === "text")
          ? "overview"
          : initialTab
      )
      setName(channel.name ?? "")
      setTopic(channel.topic ?? "")
      setProfileId(channel.agentProfileId ?? INHERIT)
      setAgentId(channel.agentId)
    }
  }, [open, channel.id])

  // The draft follows the agent picked, not every refetch of it, so an
  // unsaved edit survives someone else's change.
  const selectedAgentId = selectedAgent?.id ?? null
  useEffect(() => {
    setAgentDraft(open && selectedAgent ? agentDraftOf(selectedAgent) : null)
  }, [open, selectedAgentId])
  const agentEdits =
    selectedAgent && agentDraft ? agentChanges(agentDraft, selectedAgent) : null
  // Without channel:update, only the person who made the agent may change
  // how it appears, and nobody changes which agent is here.
  const madeAgent =
    !!selectedAgent && selectedAgent.createdById === session?.user.id
  const canEditAgent = !overviewOnly || madeAgent

  // An agent carries what it hears, so only one with the channel's audience
  // can be here: the whole workspace's, or this private container's.
  const container = channel.parentId
    ? channelList?.categories.find((cat) => cat.id === channel.parentId)
    : channel
  const agentAudience =
    container?.audience === "members" ? (container?.id ?? null) : null
  const fittingAgents = agents.filter(
    (agent) => (agent.accessContainerId ?? null) === agentAudience
  )
  const channelNames = new Map(
    [
      ...(channelList?.uncategorized ?? []),
      ...(channelList?.categories.flatMap((cat) => cat.channels) ?? []),
    ].map((ch) => [ch.id, ch.name])
  )
  const alsoIn = (selectedAgent?.channelIds ?? [])
    .filter((id) => id !== channel.id)
    .flatMap((id) => channelNames.get(id) ?? [])

  const newAgentMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceSlug) throw new Error("Missing workspace slug")
      return createAgent(workspaceSlug, {
        accessContainerId: agentAudience,
        role: channel.name,
      })
    },
    onSuccess: async (made) => {
      if (workspaceSlug) {
        await queryClient.invalidateQueries({
          queryKey: agentsKey(workspaceSlug),
        })
      }
      setAgentId(made.id)
    },
    onError: (error) => toast.error(error.message),
  })

  const { data: profilesData } = useQuery({
    queryKey: ["agent-profiles", workspaceSlug],
    enabled: open && !!workspaceSlug && !overviewOnly,
    queryFn: async () => {
      if (!workspaceSlug) throw new Error("Missing workspace slug")
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load profiles")
      return res.json()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceSlug) {
        throw new Error("Missing workspace slug")
      }

      const validatedWorkspaceSlug = workspaceSlug
      // The agent's own settings first: they are the agent's, and show in
      // every channel it is in.
      if (selectedAgent && agentEdits && canEditAgent) {
        await saveAgent(validatedWorkspaceSlug, selectedAgent.id, agentEdits)
      }
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug: validatedWorkspaceSlug, channelId: channel.id },
        json: {
          name,
          ...(isCategory ? {} : { topic: topic || undefined }),
          ...(overviewOnly
            ? {}
            : { agentProfileId: profileId === INHERIT ? null : profileId }),
          ...(!overviewOnly &&
          channel.type === "text" &&
          agentId !== channel.agentId
            ? { agentId }
            : {}),
        },
      })
      if (!res.ok) {
        const label = isCategory ? "category" : "channel"
        let message = `Failed to update ${label}`
        const responseText = await res.text()

        if (responseText) {
          try {
            const parsed = JSON.parse(responseText) as { message?: string }
            message =
              typeof parsed.message === "string" ? parsed.message : responseText
          } catch {
            message = responseText
          }
        }

        throw new Error(message)
      }
      return {
        workspaceSlug: validatedWorkspaceSlug,
        channel: await res.json(),
      }
    },
    // The sidebar and the channel header show the new name and topic at
    // once; the server's row replaces them with no refetch, and a failure
    // restores both.
    onMutate: async () => {
      if (!workspaceSlug) return undefined
      const detailKey = channelQueryOptions(workspaceSlug, channel.id).queryKey
      const change = {
        name,
        ...(isCategory ? {} : { topic: topic || null }),
      }
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
      return { workspaceSlug, detailKey, previousDetail, previousList }
    },
    onSuccess: ({
      workspaceSlug: validatedWorkspaceSlug,
      channel: updated,
    }) => {
      queryClient.setQueryData(
        channelQueryOptions(validatedWorkspaceSlug, channel.id).queryKey,
        updated
      )
      void patchChannelList(queryClient, validatedWorkspaceSlug, (list) =>
        upsertChannel(list, updated)
      )
      void queryClient.invalidateQueries({
        queryKey: agentsKey(validatedWorkspaceSlug),
      })
      onOpenChange(false)
    },
    onError: (error, _vars, context) => {
      if (context) {
        queryClient.setQueryData(context.detailKey, context.previousDetail)
        restoreChannelList(
          queryClient,
          context.workspaceSlug,
          context.previousList
        )
      }
      const label = isCategory ? "category" : "channel"
      toast.error(
        error instanceof Error ? error.message : `Failed to update ${label}`
      )
    },
  })

  const hasChanges =
    name !== (channel.name ?? "") ||
    (!isCategory && topic !== (channel.topic ?? "")) ||
    profileId !== (channel.agentProfileId ?? INHERIT) ||
    agentId !== channel.agentId ||
    (canEditAgent && agentEdits !== null)
  const isValid =
    name.trim().length > 0 && (!agentDraft || agentDraft.name.trim().length > 0)

  const selectedProfile =
    profileId === INHERIT
      ? null
      : (profilesData?.profiles.find((p) => p.id === profileId) ?? null)
  const defaultProfile = profilesData?.profiles.find((p) => p.isDefault) ?? null
  const previewProfile = selectedProfile ?? defaultProfile
  const customProfiles =
    profilesData?.profiles.filter((p) => !p.isDefault) ?? []

  // Webhooks post into the channel feed — text channels only.
  // A creator without channel:update sees the Agent tab only for an agent
  // they made, and only how it appears.
  const visibleTabs = overviewOnly
    ? TABS.filter(
        (t) =>
          t.id === "overview" ||
          (t.id === "profile" && channel.type === "text" && madeAgent)
      )
    : channel.type === "text"
      ? TABS
      : TABS.filter((t) => t.id !== "webhooks")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl md:max-w-3xl lg:max-w-5xl">
        <DialogHeader className="flex-row items-center gap-2 border-border border-b px-5 py-3 text-left">
          <DialogTitle>
            {isCategory ? "Edit Category" : "Edit Channel"}
          </DialogTitle>
          {!isCategory && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(channel.id)
                } catch {
                  toast.error("Failed to copy channel ID")
                  return
                }
                setIdCopied(true)
                setTimeout(() => setIdCopied(false), 1500)
              }}
            >
              <HugeiconsIcon
                icon={idCopied ? Tick02Icon : Copy01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
              Copy ID
            </Button>
          )}
          <DialogDescription className="sr-only">
            Manage this {isCategory ? "category" : "channel"}'s settings.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (hasChanges && isValid) {
              updateMutation.mutate()
            }
          }}
        >
          {/* Webhooks save as they change, so that tab has no footer; its
            body takes the footer's height so the dialog doesn't jump. */}
          <div
            className={cn(
              "flex",
              tab === "webhooks" ? "h-[521px]" : "h-[460px]"
            )}
          >
            <nav className="flex w-48 shrink-0 flex-col gap-1 border-border border-r bg-sidebar p-3">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    tab === t.id
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <HugeiconsIcon
                    icon={t.icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="min-w-0 flex-1 overflow-y-auto p-6">
              <div className="mx-auto w-full max-w-xl space-y-4">
                {tab === "overview" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="channel-name">Name</Label>
                      <Input
                        id="channel-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                      />
                    </div>
                    {!isCategory && (
                      <div className="space-y-2">
                        <Label htmlFor="channel-topic">Topic</Label>
                        <Textarea
                          id="channel-topic"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          maxLength={1024}
                          placeholder="What's this channel about?"
                          rows={3}
                        />
                      </div>
                    )}
                  </>
                ) : tab === "webhooks" ? (
                  workspaceSlug ? (
                    <ChannelWebhooksTab
                      workspaceSlug={workspaceSlug}
                      channelId={channel.id}
                      channelName={channel.name}
                    />
                  ) : null
                ) : (
                  <div className="space-y-3">
                    {channel.type === "text" && workspaceSlug && (
                      <>
                        {!overviewOnly && (
                          <div className="space-y-2">
                            <Label htmlFor="channel-agent">
                              Agent in this channel
                            </Label>
                            <div className="flex gap-2">
                              <Select
                                items={[
                                  { value: NO_AGENT, label: "No agent" },
                                  ...fittingAgents.map((agent) => ({
                                    value: agent.id,
                                    label: agent.name,
                                  })),
                                ]}
                                value={agentId ?? NO_AGENT}
                                onValueChange={(value) =>
                                  value &&
                                  setAgentId(value === NO_AGENT ? null : value)
                                }
                              >
                                <SelectTrigger
                                  id="channel-agent"
                                  className="min-w-0 flex-1"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_AGENT}>
                                    No agent
                                  </SelectItem>
                                  {fittingAgents.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                      {agent.name}
                                      {agent.role && (
                                        <span className="text-muted-foreground">
                                          {" "}
                                          · {agent.role}
                                        </span>
                                      )}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={newAgentMutation.isPending}
                                onClick={() => newAgentMutation.mutate()}
                              >
                                New agent
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {selectedAgent
                                ? `${selectedAgent.name} reads along here, and a mention or a reply wakes it at once.`
                                : "People talk here and nothing answers. Add an agent to have one read along."}
                            </p>
                          </div>
                        )}
                        {selectedAgent && agentDraft && (
                          <>
                            {alsoIn.length > 0 && (
                              <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                {selectedAgent.name} is also in{" "}
                                {alsoIn.map((name) => `#${name}`).join(", ")}.
                                Its name, brief and facts are the same there.
                              </p>
                            )}
                            {canEditAgent && (
                              <AgentFields
                                workspaceSlug={workspaceSlug}
                                draft={agentDraft}
                                onChange={setAgentDraft}
                                appearanceOnly={overviewOnly}
                                idPrefix="channel-agent"
                              />
                            )}
                            {!overviewOnly &&
                              selectedAgent.id === channel.agentId && (
                                <DiscordChatSection
                                  key={channel.id}
                                  workspaceSlug={workspaceSlug}
                                  channelId={channel.id}
                                  agentName={selectedAgent.name}
                                />
                              )}
                            {/* Any member may edit facts, as the API allows. */}
                            <AgentFactsList
                              key={selectedAgent.id}
                              workspaceSlug={workspaceSlug}
                              agentId={selectedAgent.id}
                              agentName={selectedAgent.name}
                            />
                          </>
                        )}
                      </>
                    )}
                    {!overviewOnly && customProfiles.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="channel-agent-profile">Profile</Label>
                        <Select
                          items={[
                            {
                              value: INHERIT,
                              label: isCategory
                                ? "Inherit (workspace default)"
                                : "Inherit (category or default)",
                            },
                            ...customProfiles.map((p) => ({
                              value: p.id,
                              label: p.name,
                            })),
                          ]}
                          value={profileId}
                          onValueChange={(v) => v && setProfileId(v)}
                        >
                          <SelectTrigger
                            id="channel-agent-profile"
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={INHERIT}>
                              {isCategory
                                ? "Inherit (workspace default)"
                                : "Inherit (category or default)"}
                            </SelectItem>
                            {customProfiles.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {!overviewOnly && previewProfile && profilesData && (
                      <ProfileCapabilities
                        profile={previewProfile}
                        groups={profilesData.availableToolGroups}
                      />
                    )}

                    {!overviewOnly && customProfiles.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add agent profiles in workspace settings to give
                        channels different tools.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {tab !== "webhooks" && (
            <DialogFooter className="border-border border-t px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!hasChanges || !isValid || updateMutation.isPending}
              >
                <MorphText>
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </MorphText>
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
