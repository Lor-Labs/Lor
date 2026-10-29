import {
  Layers01Icon,
  Settings01Icon,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
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

type Tab = "overview" | "profile" | "webhooks"
const TABS: { id: Tab; label: string; icon: IconSvgElement }[] = [
  { id: "overview", label: "Overview", icon: Settings01Icon },
  { id: "profile", label: "Agent profile", icon: Layers01Icon },
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
}: {
  channel: Channel
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The channel's creator without channel:update: name and topic only. */
  overviewOnly?: boolean
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const isCategory = channel.type === "category"

  const [tab, setTab] = useState<Tab>("overview")
  const [name, setName] = useState(channel.name ?? "")
  const [topic, setTopic] = useState(channel.topic ?? "")
  const [profileId, setProfileId] = useState(channel.agentProfileId ?? INHERIT)

  useEffect(() => {
    if (open) {
      setTab("overview")
      setName(channel.name ?? "")
      setTopic(channel.topic ?? "")
      setProfileId(channel.agentProfileId ?? INHERIT)
    }
  }, [open, channel.name, channel.topic, channel.agentProfileId])

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
    profileId !== (channel.agentProfileId ?? INHERIT)
  const isValid = name.trim().length > 0

  const selectedProfile =
    profileId === INHERIT
      ? null
      : (profilesData?.profiles.find((p) => p.id === profileId) ?? null)
  const defaultProfile = profilesData?.profiles.find((p) => p.isDefault) ?? null
  const previewProfile = selectedProfile ?? defaultProfile
  const customProfiles =
    profilesData?.profiles.filter((p) => !p.isDefault) ?? []

  // Webhooks post into the channel feed — text channels only.
  const visibleTabs = overviewOnly
    ? TABS.filter((t) => t.id === "overview")
    : channel.type === "text"
      ? TABS
      : TABS.filter((t) => t.id !== "webhooks")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl md:max-w-3xl lg:max-w-5xl">
        <DialogHeader className="border-border border-b px-5 py-3 text-left">
          <DialogTitle>
            {isCategory ? "Edit Category" : "Edit Channel"}
          </DialogTitle>
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
                    {customProfiles.length > 0 && (
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

                    {previewProfile && profilesData && (
                      <ProfileCapabilities
                        profile={previewProfile}
                        groups={profilesData.availableToolGroups}
                      />
                    )}

                    {customProfiles.length === 0 && (
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
