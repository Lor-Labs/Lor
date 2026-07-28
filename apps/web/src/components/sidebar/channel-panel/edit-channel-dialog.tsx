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
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { Layers, Settings, Webhook } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChannelWebhooksTab } from "@/components/sidebar/channel-panel/channel-webhooks-tab"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AvailableCapability,
  Channel,
} from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"

const INHERIT = "__inherit__"

type Tab = "overview" | "profile" | "webhooks"
const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: "overview", label: "Overview", icon: Settings },
  { id: "profile", label: "Agent profile", icon: Layers },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
]

function ProfileCapabilities({
  profile,
  available,
}: {
  profile: AgentProfile
  available: AvailableCapability[]
}) {
  const granted = profile.grantsAll
    ? available
    : available.filter((c) => profile.capabilities.includes(c.key))

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">
        Merlin can use
      </div>
      {granted.length === 0 ? (
        <p className="text-xs text-muted-foreground">No connectors.</p>
      ) : (
        <ul className="space-y-2">
          {granted.map((c) => {
            const Icon = connectorLogo(c.connector)
            return (
              <li key={c.key} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.description}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function EditChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel
  open: boolean
  onOpenChange: (open: boolean) => void
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
    enabled: open && !!workspaceSlug,
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
          agentProfileId: profileId === INHERIT ? null : profileId,
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
    onSuccess: ({ workspaceSlug: validatedWorkspaceSlug }) => {
      queryClient.invalidateQueries({
        queryKey: ["channels", validatedWorkspaceSlug],
      })
      queryClient.invalidateQueries({
        queryKey: ["channel", validatedWorkspaceSlug, channel.id],
      })
      onOpenChange(false)
    },
    onError: (error) => {
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
  const visibleTabs =
    channel.type === "text" ? TABS : TABS.filter((t) => t.id !== "webhooks")

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
          <div className="flex h-[460px]">
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
                  <t.icon className="size-4" />
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
                        <Label htmlFor="channel-merlin-profile">Profile</Label>
                        <Select
                          value={profileId}
                          onValueChange={(v) => v && setProfileId(v)}
                        >
                          <SelectTrigger
                            id="channel-merlin-profile"
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
                        available={profilesData.availableCapabilities}
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
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
