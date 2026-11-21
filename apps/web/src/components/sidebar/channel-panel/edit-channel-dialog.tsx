import {
  Copy01Icon,
  Layers01Icon,
  Settings01Icon,
  Tick02Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
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
import {
  AGENT_NAME_MAX,
  CREATURES,
  type CreatureId,
  channelAgentIdentity,
  isCreatureId,
} from "@repo/utils/bestiary"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { DiscordChatSection } from "@/components/agent/discord-chat-section"
import { AgentFactsList } from "@/components/sidebar/channel-panel/agent-facts-list"
import { AgentModelSelect } from "@/components/sidebar/channel-panel/agent-model-select"
import { ChannelWebhooksTab } from "@/components/sidebar/channel-panel/channel-webhooks-tab"
import { MorphText } from "@/components/ui/morph-text"
import { GrantedChips } from "@/components/workspace/agent-profiles-section"
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

const INHERIT = "__inherit__"

// When the channel's agent takes a turn (reference/always-on-agents.md §3).
const WAKE_MODES = [
  { value: "mention", label: "When mentioned or replied to" },
  { value: "every_message", label: "To every message" },
] as const

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
  const [agentModel, setAgentModel] = useState(channel.agentModel ?? null)
  const [wakeMode, setWakeMode] = useState(channel.agentWakeMode ?? "mention")
  const [brief, setBrief] = useState(channel.agentBrief ?? "")
  const [agentName, setAgentName] = useState(channel.agentName ?? "")
  const [agentCreature, setAgentCreature] = useState<CreatureId | null>(
    isCreatureId(channel.agentCreature) ? channel.agentCreature : null
  )
  // Only edited agent fields are sent, so a stale draft never overwrites a
  // change someone else saved while the dialog was open.
  const [edited, setEdited] = useState<{
    model?: boolean
    wakeMode?: boolean
    brief?: boolean
    agentName?: boolean
    agentCreature?: boolean
  }>({})

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
      setAgentModel(channel.agentModel ?? null)
      setWakeMode(channel.agentWakeMode ?? "mention")
      setBrief(channel.agentBrief ?? "")
      setAgentName(channel.agentName ?? "")
      setAgentCreature(
        isCreatureId(channel.agentCreature) ? channel.agentCreature : null
      )
      setEdited({})
    }
  }, [open, channel.id])

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
          ...(overviewOnly || isCategory
            ? {}
            : {
                ...(edited.model ? { agentModel } : {}),
                ...(edited.wakeMode ? { agentWakeMode: wakeMode } : {}),
                ...(edited.brief ? { agentBrief: brief.trim() || null } : {}),
              }),
          // The channel's creator may name its agent too.
          ...(channel.type === "text" && edited.agentName
            ? { agentName: agentName.trim() || null }
            : {}),
          ...(channel.type === "text" && edited.agentCreature
            ? { agentCreature }
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
    agentModel !== (channel.agentModel ?? null) ||
    wakeMode !== (channel.agentWakeMode ?? "mention") ||
    brief !== (channel.agentBrief ?? "") ||
    agentName !== (channel.agentName ?? "") ||
    agentCreature !== (channel.agentCreature ?? null)
  const isValid = name.trim().length > 0
  // What the agent will be called and look like once saved: a blank name
  // takes the creature's default (reference/always-on-agents.md, decision 32).
  const identity = channelAgentIdentity({
    id: channel.id,
    agentName: agentName.trim() || null,
    agentCreature,
  })
  const defaultName = channelAgentIdentity({
    id: channel.id,
    agentCreature,
  }).name

  const selectedProfile =
    profileId === INHERIT
      ? null
      : (profilesData?.profiles.find((p) => p.id === profileId) ?? null)
  const defaultProfile = profilesData?.profiles.find((p) => p.isDefault) ?? null
  const previewProfile = selectedProfile ?? defaultProfile
  const customProfiles =
    profilesData?.profiles.filter((p) => !p.isDefault) ?? []

  // Webhooks post into the channel feed — text channels only.
  // A creator without channel:update sees the Agent tab for its name and
  // creature only.
  const visibleTabs = overviewOnly
    ? TABS.filter(
        (t) =>
          t.id === "overview" || (t.id === "profile" && channel.type === "text")
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
                        <div className="flex gap-4">
                          <div className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                            <AgentCreature
                              creature={identity.creature}
                              size={72}
                              label={identity.name}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <Label htmlFor="channel-agent-name">Name</Label>
                            <Input
                              id="channel-agent-name"
                              value={agentName}
                              onChange={(e) => {
                                setAgentName(e.target.value)
                                setEdited((prev) => ({
                                  ...prev,
                                  agentName: true,
                                }))
                              }}
                              maxLength={AGENT_NAME_MAX}
                              placeholder={defaultName}
                            />
                            <p className="text-xs text-muted-foreground">
                              What the channel calls its agent. People mention
                              it as @{identity.name}.
                            </p>
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
                                aria-pressed={identity.creature === creature.id}
                                onClick={() => {
                                  setAgentCreature(creature.id)
                                  setEdited((prev) => ({
                                    ...prev,
                                    agentCreature: true,
                                  }))
                                }}
                                className={cn(
                                  "flex cursor-pointer flex-col items-center gap-0.5 rounded-md border px-1 pt-1.5 pb-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60",
                                  identity.creature === creature.id
                                    ? "border-primary bg-accent text-foreground"
                                    : "border-transparent"
                                )}
                              >
                                <AgentCreature
                                  creature={creature.id}
                                  size={48}
                                  still
                                />
                                <span className="truncate">
                                  {creature.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {!overviewOnly && (
                          <>
                            <DiscordChatSection
                              key={channel.id}
                              workspaceSlug={workspaceSlug}
                              channelId={channel.id}
                              agentName={identity.name}
                            />
                            <div className="space-y-2">
                              <Label htmlFor="channel-agent-model">Model</Label>
                              <AgentModelSelect
                                id="channel-agent-model"
                                workspaceSlug={workspaceSlug}
                                value={agentModel}
                                onChange={(model) => {
                                  setAgentModel(model)
                                  setEdited((e) => ({ ...e, model: true }))
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="channel-agent-wake">
                                Answers
                              </Label>
                              <Select
                                items={WAKE_MODES}
                                value={wakeMode}
                                onValueChange={(v) => {
                                  if (!v) return
                                  setWakeMode(v as typeof wakeMode)
                                  setEdited((e) => ({ ...e, wakeMode: true }))
                                }}
                              >
                                <SelectTrigger
                                  id="channel-agent-wake"
                                  className="w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {WAKE_MODES.map((mode) => (
                                    <SelectItem
                                      key={mode.value}
                                      value={mode.value}
                                    >
                                      {mode.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                {identity.name} reads every message here either
                                way. This sets which ones it answers right away.
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="channel-agent-brief">Brief</Label>
                              <Textarea
                                id="channel-agent-brief"
                                value={brief}
                                onChange={(e) => {
                                  setBrief(e.target.value)
                                  setEdited((prev) => ({
                                    ...prev,
                                    brief: true,
                                  }))
                                }}
                                maxLength={4000}
                                rows={4}
                                placeholder={`What ${identity.name} should know and do here, e.g. “Watch deploys and tell us in two lines when one fails. Zoe owns the pipeline.”`}
                              />
                              <p className="text-xs text-muted-foreground">
                                Standing instructions for {identity.name} in
                                this channel. Only people write the brief.
                              </p>
                            </div>
                          </>
                        )}
                        {/* Any member may edit facts, as the API allows. */}
                        <AgentFactsList
                          workspaceSlug={workspaceSlug}
                          channelId={channel.id}
                        />
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
