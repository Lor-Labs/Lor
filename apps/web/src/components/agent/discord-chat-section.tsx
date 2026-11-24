import { Copy01Icon, DiscordIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  SETTINGS_SURFACE,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  channelDiscordKey,
  useChannelDiscord,
} from "@/hooks/use-channel-discord"
import { apiClient } from "@/lib/api-client"

// Where the channel's chat lives (reference/always-on-agents.md §10,
// decision 22): Lor by default, or a linked Discord channel. Linking is a
// code made here and run as `/lor link` in the Discord channel, which proves
// the person can manage that channel too.
export function DiscordChatSection({
  workspaceSlug,
  channelId,
  agentName,
}: {
  workspaceSlug: string
  channelId: string
  agentName: string
}) {
  const queryClient = useQueryClient()
  const { data } = useChannelDiscord(workspaceSlug, channelId)
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const params = { workspaceSlug, channelId }

  const makeCode = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].discord["link-code"].$post({ param: params })
      if (!res.ok) throw new Error("Couldn't make a link code")
      return res.json()
    },
    onSuccess: (result) => {
      setCode(result.code)
      setExpiresAt(new Date(result.expiresAt).getTime())
    },
    onError: (error) => toast.error(error.message),
  })
  const unlink = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].discord.$delete({ param: params })
      if (!res.ok) throw new Error("Couldn't move the chat back to Lor")
    },
    onSuccess: () => {
      setCode(null)
      void queryClient.invalidateQueries({
        queryKey: channelDiscordKey(workspaceSlug, channelId),
      })
    },
    onError: (error) => toast.error(error.message),
  })

  if (!data) return null
  const command = code ? `/lor link code:${code}` : ""

  return (
    <SettingsSection title="Where the chat lives">
      {data.link ? (
        <div className={cn(SETTINGS_SURFACE, "flex items-center gap-3 p-4")}>
          <HugeiconsIcon
            icon={DiscordIcon}
            className="size-5 shrink-0 text-[#5865F2]"
            strokeWidth={2}
          />
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium">
              In Discord, #{data.link.channelName ?? "channel"}
              {data.link.guildName ? ` in ${data.link.guildName}` : ""}
            </div>
            <div className="text-muted-foreground text-xs">
              People talk to {agentName} there. Lor shows the chat read-only.
            </div>
          </div>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            render={
              // biome-ignore lint/a11y/useAnchorContent: Button renders the label inside
              <a href={data.link.url} target="_blank" rel="noreferrer" />
            }
          >
            Open
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            Move back to Lor
          </Button>
        </div>
      ) : !data.available ? (
        <p
          className={cn(
            SETTINGS_SURFACE,
            "px-4 py-3 text-muted-foreground text-sm"
          )}
        >
          In Lor. Discord isn't set up on this Lor server.
        </p>
      ) : code ? (
        <div className={cn(SETTINGS_SURFACE, "space-y-2 p-4 text-sm")}>
          <p>
            1. Add Lor to your Discord server, if it isn't there yet.{" "}
            {data.inviteUrl && (
              <a
                href={data.inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Add to Discord
              </a>
            )}
          </p>
          <p>2. In the Discord channel, run:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
              {command}
            </code>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(command).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
              Copy
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            The code works once, for 15 minutes. Running it needs the Manage
            Channels permission there. This page updates when it links.
          </p>
          {/* Checked when it renders; an expired code says so here. */}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={makeCode.isPending}
            onClick={() => makeCode.mutate()}
          >
            {expiresAt !== null && Date.now() > expiresAt
              ? "This code expired. Get a new one"
              : "Get a new code"}
          </Button>
        </div>
      ) : (
        <div className={cn(SETTINGS_SURFACE, "flex items-center gap-3 p-4")}>
          <p className="min-w-0 flex-1 text-muted-foreground text-sm">
            In Lor. Move it to a Discord channel and the team talks to{" "}
            {agentName} there.
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={makeCode.isPending}
            onClick={() => makeCode.mutate()}
          >
            <HugeiconsIcon
              icon={DiscordIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            Move to Discord
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
