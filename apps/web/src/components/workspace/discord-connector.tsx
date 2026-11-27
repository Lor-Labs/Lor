import {
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  DiscordIcon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/menu"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  IconTile,
  PILL_BUTTON,
  SETTINGS_SURFACE,
  SettingsAction,
  SettingsBackButton,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { chatsKey } from "@/hooks/use-chats"
import { apiClient } from "@/lib/api-client"

// Discord in Connectors (reference/agents-and-chats.md, decision 51): a
// server is connected once, with a code run as `/lor link` there, and each
// of its channels can hold agents. A channel with agents is a hidden Lor
// chat (kind "place") that the sidebar's filter shows.

const discordRoute = apiClient.v1.workspaces[":workspaceSlug"].discord

const discordKey = (workspaceSlug: string) =>
  ["discord", workspaceSlug] as const

export function workspaceDiscordQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: discordKey(workspaceSlug),
    queryFn: async () => {
      const res = await discordRoute.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Couldn't load Discord")
      return res.json()
    },
  })
}

async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

function DiscordTile({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <IconTile size={size}>
      <HugeiconsIcon
        icon={DiscordIcon}
        className={cn("text-[#5865F2]", size === "lg" ? "size-7" : "size-5")}
        strokeWidth={2}
      />
    </IconTile>
  )
}

// Discord's row in the connectors list.
export function DiscordConnectorRow({
  workspaceSlug,
  onOpen,
}: {
  workspaceSlug: string
  onOpen: () => void
}) {
  const { data } = useQuery(workspaceDiscordQueryOptions(workspaceSlug))
  const servers = data?.servers ?? []
  const channels = servers.reduce((sum, s) => sum + s.places.length, 0)
  const subtitle =
    servers.length > 0
      ? [
          servers.length === 1
            ? (servers[0]?.name ?? "1 server")
            : `${servers.length} servers`,
          `${channels} ${channels === 1 ? "channel" : "channels"} with agents`,
        ].join(" · ")
      : "Talk to your agents in Discord channels"
  return (
    <div className="flex items-center rounded-xl transition-colors hover:bg-accent/50">
      <button
        type="button"
        data-connector="discord"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DiscordTile />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">Discord</span>
          <span className="block truncate text-muted-foreground text-sm">
            {subtitle}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
      </button>
    </div>
  )
}

export function useDiscordConnected(workspaceSlug: string) {
  const { data } = useQuery(workspaceDiscordQueryOptions(workspaceSlug))
  return (data?.servers.length ?? 0) > 0
}

export function DiscordConnectorDetail({
  workspaceSlug,
  onBack,
}: {
  workspaceSlug: string
  onBack: () => void
}) {
  const canManage = useCanManageChannels(workspaceSlug)
  const [code, setCode] = useState<{
    code: string
    expiresAt: number
    inviteUrl: string | null
  } | null>(null)
  const { data, isPending } = useQuery({
    ...workspaceDiscordQueryOptions(workspaceSlug),
    // While a code is out, the page notices the server connecting.
    refetchInterval: code ? 3000 : false,
  })
  const servers = data?.servers ?? []

  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.servers.map((s) => s.guildId))
    if (known.current && code) {
      const added = data.servers.find((s) => !known.current?.has(s.guildId))
      if (added) {
        setCode(null)
        toast.success(`Connected ${added.name ?? "the server"}`)
      }
    }
    known.current = ids
  }, [data, code])

  const makeCode = useMutation({
    mutationFn: async () => {
      const res = await discordRoute["link-code"].$post({
        param: { workspaceSlug },
      })
      if (!res.ok) throw await failure(res, "Couldn't make a code")
      return res.json()
    },
    onSuccess: (made) =>
      setCode({
        code: made.code,
        expiresAt: new Date(made.expiresAt).getTime(),
        inviteUrl: made.inviteUrl,
      }),
    onError: (error) => toast.error(error.message),
  })

  const status =
    servers.length > 0
      ? `Connected · ${servers.map((s) => s.name ?? "Server").join(", ")}`
      : "Not connected"

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SettingsBackButton label="All connectors" onClick={onBack} />
        <div className="flex items-center gap-4">
          <DiscordTile size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-lg">Discord</h2>
            <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
              {servers.length > 0 && (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-success"
                />
              )}
              <span className="truncate">{status}</span>
            </p>
          </div>
          {canManage && data?.available && !code && (
            <Button
              className={PILL_BUTTON}
              variant={servers.length > 0 ? "secondary" : "default"}
              loading={makeCode.isPending}
              onClick={() => makeCode.mutate()}
            >
              {servers.length > 0 ? "Connect another server" : "Connect"}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          Put agents in your Discord channels. People mention an agent there and
          it answers under its own name, with its tools, memory and Loops. Lor
          keeps a copy of each channel, hidden from the sidebar until you turn
          on Discord channels in its filter.
        </p>
      </div>

      {isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : !data?.available ? (
        <p
          className={cn(
            SETTINGS_SURFACE,
            "px-4 py-3 text-muted-foreground text-sm"
          )}
        >
          Discord isn't set up on this Lor server.
        </p>
      ) : (
        <>
          {code && (
            <ConnectSteps
              code={code}
              renewing={makeCode.isPending}
              onRenew={() => makeCode.mutate()}
              onCancel={() => setCode(null)}
            />
          )}
          {servers.map((server) => (
            <ServerSection
              key={server.guildId}
              workspaceSlug={workspaceSlug}
              server={server}
              canManage={canManage}
            />
          ))}
        </>
      )}
    </div>
  )
}

function ConnectSteps({
  code,
  renewing,
  onRenew,
  onCancel,
}: {
  code: { code: string; expiresAt: number; inviteUrl: string | null }
  renewing: boolean
  onRenew: () => void
  onCancel: () => void
}) {
  const [copied, setCopied] = useState(false)
  const command = `/lor link code:${code.code}`
  const expired = Date.now() > code.expiresAt
  return (
    <SettingsSection
      title="Connect a server"
      action={<SettingsAction onClick={onCancel}>Cancel</SettingsAction>}
    >
      <div className={cn(SETTINGS_SURFACE, "space-y-4 p-4 text-sm")}>
        <div className="space-y-1">
          <p className="font-medium">1. Add Lor to your Discord server</p>
          <p className="text-muted-foreground">
            Skip this if Lor is already there.{" "}
            {code.inviteUrl && (
              <a
                href={code.inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Add to Discord
              </a>
            )}
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-medium">2. In any channel of that server, run</p>
          <div className="flex items-center gap-2 rounded-lg bg-background py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">
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
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {expired
              ? "This code expired."
              : "The code works once, for 15 minutes, for someone who can manage that server. This page updates when it connects."}{" "}
            <button
              type="button"
              disabled={renewing}
              onClick={onRenew}
              className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
            >
              Get a new code
            </button>
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}

type Server = {
  guildId: string
  name: string | null
  places: Array<{
    channelId: string
    discordChannelId: string
    name: string | null
    url: string
    agentIds: string[]
  }>
}

function ServerSection({
  workspaceSlug,
  server,
  canManage,
}: {
  workspaceSlug: string
  server: Server
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const agents = useAgents(workspaceSlug)
  const [confirming, setConfirming] = useState(false)
  const param = { workspaceSlug, guildId: server.guildId }
  const channelsKey = ["discord", workspaceSlug, server.guildId, "channels"]
  const { data, isPending, isError } = useQuery({
    queryKey: channelsKey,
    queryFn: async () => {
      const res = await discordRoute.servers[":guildId"].channels.$get({
        param,
      })
      if (!res.ok) throw await failure(res, "Couldn't load its channels")
      return res.json()
    },
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: discordKey(workspaceSlug) }),
      queryClient.invalidateQueries({ queryKey: channelsKey }),
      queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
    ])

  const add = useMutation({
    mutationFn: async (input: {
      discordChannelId: string
      agentId: string
    }) => {
      const res = await discordRoute.places.$post({
        param: { workspaceSlug },
        json: { guildId: server.guildId, ...input },
      })
      if (!res.ok) throw await failure(res, "Couldn't add the agent")
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: async (input: { channelId: string; agentId: string }) => {
      const res = await discordRoute.places[":channelId"].agents[
        ":agentId"
      ].$delete({ param: { workspaceSlug, ...input } })
      if (!res.ok) throw await failure(res, "Couldn't take the agent out")
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await discordRoute.servers[":guildId"].$delete({ param })
      if (!res.ok) throw await failure(res, "Couldn't disconnect the server")
    },
    onSuccess: async () => {
      setConfirming(false)
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  const placeOf = new Map(server.places.map((p) => [p.discordChannelId, p]))
  const busy = add.isPending || remove.isPending
  // Channels with agents first, then the rest in Discord's order.
  const channels = [...(data?.channels ?? [])].sort(
    (a, b) => Number(b.agentIds.length > 0) - Number(a.agentIds.length > 0)
  )

  return (
    <SettingsSection
      title={server.name ?? "Discord server"}
      count={server.places.length || undefined}
      action={
        canManage ? (
          <SettingsAction onClick={() => setConfirming(true)}>
            Disconnect
          </SettingsAction>
        ) : undefined
      }
    >
      {isPending ? (
        <div className={cn(SETTINGS_SURFACE, "flex justify-center py-5")}>
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : isError ? (
        <p
          className={cn(
            SETTINGS_SURFACE,
            "px-4 py-3 text-muted-foreground text-sm"
          )}
        >
          Couldn't load this server's channels. Lor may have been removed from
          it.
        </p>
      ) : (
        <SettingsGroup>
          {channels.map((channel) => {
            const place = placeOf.get(channel.id)
            const inIt = channel.agentIds.flatMap(
              (id) => agents.find((agent) => agent.id === id) ?? []
            )
            const others = agents.filter(
              (agent) => !channel.agentIds.includes(agent.id)
            )
            return (
              <div
                key={channel.id}
                className="flex min-h-12 flex-wrap items-center gap-2 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-muted-foreground">#</span>{" "}
                  {place ? (
                    <a
                      href={place.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {channel.name}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">
                      {channel.name}
                    </span>
                  )}
                </span>
                {inIt.map((agent) => (
                  <span
                    key={agent.id}
                    className="flex h-7 items-center gap-1.5 rounded-full bg-background pr-1 pl-1.5 text-[13px]"
                  >
                    <AgentCreature
                      creature={agentCreature(agent)}
                      size={18}
                      still
                    />
                    {agent.name}
                    {canManage && place ? (
                      <button
                        type="button"
                        aria-label={`Take ${agent.name} out of #${channel.name}`}
                        disabled={busy}
                        onClick={() =>
                          remove.mutate({
                            channelId: place.channelId,
                            agentId: agent.id,
                          })
                        }
                        className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.92] disabled:opacity-60"
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          className="size-3"
                          strokeWidth={2}
                        />
                      </button>
                    ) : (
                      <span className="w-1" />
                    )}
                  </span>
                ))}
                {canManage && others.length > 0 && (
                  <Menu>
                    <MenuTrigger
                      disabled={busy}
                      aria-label={`Add an agent to #${channel.name}`}
                      className="flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[13px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-60 data-popup-open:bg-foreground/[0.06]"
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        className="size-3.5"
                        strokeWidth={2}
                      />
                      {inIt.length > 0 ? "Add" : "Add agent"}
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {others.map((agent) => (
                        <MenuItem
                          key={agent.id}
                          onClick={() =>
                            add.mutate({
                              discordChannelId: channel.id,
                              agentId: agent.id,
                            })
                          }
                        >
                          <AgentCreature
                            creature={agentCreature(agent)}
                            size={18}
                            still
                          />
                          {agent.name}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                )}
              </div>
            )
          })}
          {channels.length === 0 && (
            <p className="py-3 text-muted-foreground text-sm">
              Lor can't see any text channels in this server.
            </p>
          )}
        </SettingsGroup>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {server.name ?? "this server"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its agents leave every channel there and Lor leaves the server.
              What was said there stays in Lor, archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
