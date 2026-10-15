import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  LinkSquare02Icon,
  Search01Icon,
  SquareLock02Icon,
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
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/input-group"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { CodeBlock } from "@repo/ui/components/tool-ui/code-block"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { type Ref, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import {
  ConnectorToolPreview,
  ConnectorToolSettings,
} from "@/components/workspace/connector-tool-settings"
import { GithubBaseBranchSettings } from "@/components/workspace/github-base-branch-settings"
import {
  IconTile,
  PILL_BUTTON,
  SettingsBackButton,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { TriggerEffects } from "@/components/workspace/trigger-effects"
import { apiClient } from "@/lib/api-client"
import type {
  ConnectCloudwatchRequest,
  ConnectDatadogRequest,
  ConnectorKey,
  IntegrationStatus,
} from "@/lib/api-types"
import { isAppFocused, subscribeAppFocus } from "@/lib/app-focus"
import { connectorLogo } from "@/lib/connector-ui"
import { openGithubConnect } from "@/lib/github-connect"
import { openExternal } from "@/lib/open-external"

// How many repositories to list before collapsing the rest into a "+N more".
const REPO_DISPLAY_LIMIT = 8

// The browser callback may still be saving the connection on switch-back.
const CONNECT_RECHECK_MS = 5000

const NOTIFY_OFF = "__off__"

type TriggerConfig = {
  channelId: string | null
  post: boolean
  remember: boolean
  rememberHint: string | null
  actInstructions: string | null
  actWindowSeconds: number
  hourlyRunCap: number
  dailyRunCap: number
}

// Why this viewer can't connect the connector right now, or null when they can.
function connectBlocker(p: IntegrationStatus): string | null {
  if (!p.canManage) return "Admin only"
  if (p.authType === "api-key") return p.available ? null : "Unavailable"
  return p.connectUrl ? null : "Unavailable"
}

// The selected connector lives in the settings URL (?connector=<id>) so OAuth
// callbacks land back on the connector's detail view.
export function ConnectorsSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const selectedId =
    typeof search.connector === "string" ? search.connector : null
  const [query, setQuery] = useState("")
  const [returnFocusId, setReturnFocusId] = useState<ConnectorKey | null>(null)
  const [keyConnect, setKeyConnect] = useState<ConnectorKey | null>(null)
  const [pendingConnect, setPendingConnect] = useState<ConnectorKey | null>(
    null
  )
  const [notionConnect, setNotionConnect] = useState<{
    url: string
    replacing: boolean
  } | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<{
    connectionId: string
    name: string
  } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["integrations", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load connectors")
      return res.json()
    },
    // Connections change outside this window (OAuth runs in the browser).
    staleTime: 0,
  })

  const disconnect = useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].$delete({ param: { workspaceSlug, connectionId } })
      if (!res.ok) throw new Error("Failed to disconnect")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Disconnected")
    },
    onError: () => toast.error("Failed to disconnect"),
  })

  // The list and a detail share one scroll area; each opens at the top.
  useLayoutEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" })
  }, [selectedId])

  const openConnector = (id: ConnectorKey | null) => {
    if (id) setReturnFocusId(id)
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, connector: id ?? undefined }),
      replace: true,
    })
  }

  const startConnect = (p: IntegrationStatus) => {
    if (p.authType === "api-key") {
      setKeyConnect(p.id)
      return
    }
    if (!p.connectUrl) return
    if (p.id === "notion") {
      setNotionConnect({ url: p.connectUrl, replacing: false })
      return
    }
    if (p.id === "github") void openGithubConnect(workspaceSlug)
    else openExternal(p.connectUrl)
    setPendingConnect(p.id)
  }

  // The desktop app connects in the system browser and gets no redirect back,
  // so re-check the connectors whenever its window regains focus.
  useEffect(() => {
    let wasFocused = isAppFocused()
    let recheck: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeAppFocus((focused) => {
      if (focused && !wasFocused) {
        void refetch({ cancelRefetch: false })
        clearTimeout(recheck)
        if (pendingConnect) {
          recheck = setTimeout(
            () => void refetch({ cancelRefetch: false }),
            CONNECT_RECHECK_MS
          )
        }
      }
      wasFocused = focused
    })
    return () => {
      clearTimeout(recheck)
      unsubscribe()
    }
  }, [refetch, pendingConnect])

  useEffect(() => {
    if (!pendingConnect) return
    const landed = data?.providers.some(
      (p) => p.id === pendingConnect && p.connected
    )
    if (!landed) return
    setPendingConnect(null)
    if (selectedId !== pendingConnect) openConnector(pendingConnect)
  }, [data, pendingConnect])

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load connectors.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const selected = data.providers.find((p) => p.id === selectedId)

  return (
    <div ref={topRef} className="scroll-mt-6">
      {selected ? (
        <ConnectorDetail
          key={selected.id}
          workspaceSlug={workspaceSlug}
          provider={selected}
          disconnecting={disconnect.isPending}
          onBack={() => openConnector(null)}
          onConnect={() => startConnect(selected)}
          onReconnect={() => {
            if (selected.connectUrl) {
              setNotionConnect({ url: selected.connectUrl, replacing: true })
            }
          }}
          onDisconnect={() => {
            if (selected.connectionId) {
              setDisconnectTarget({
                connectionId: selected.connectionId,
                name: selected.name,
              })
            }
          }}
        />
      ) : (
        <ConnectorList
          providers={data.providers}
          query={query}
          onQueryChange={setQuery}
          focusId={returnFocusId}
          onOpen={(p) => openConnector(p.id)}
          onConnect={startConnect}
        />
      )}
      <DatadogConnectDialog
        workspaceSlug={workspaceSlug}
        open={keyConnect === "datadog"}
        onOpenChange={(open) => {
          if (!open) setKeyConnect(null)
        }}
        onConnected={() => openConnector("datadog")}
      />
      <BetterstackConnectDialog
        workspaceSlug={workspaceSlug}
        open={keyConnect === "betterstack"}
        onOpenChange={(open) => {
          if (!open) setKeyConnect(null)
        }}
        onConnected={() => openConnector("betterstack")}
      />
      <CloudwatchConnectDialog
        workspaceSlug={workspaceSlug}
        open={keyConnect === "cloudwatch"}
        onOpenChange={(open) => {
          if (!open) setKeyConnect(null)
        }}
        onConnected={() => openConnector("cloudwatch")}
      />
      <AlertDialog
        open={!!notionConnect}
        onOpenChange={(open) => {
          if (!open) setNotionConnect(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {notionConnect?.replacing
                ? "Reconnect Notion?"
                : "Connect Notion?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Pages selected here will be available to members of this Lor
              workspace. The Notion member authorizing the connection remains
              responsible for managing which pages it can access.
              {notionConnect?.replacing
                ? " This will replace the current Notion authorization."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (notionConnect) {
                  openExternal(notionConnect.url)
                  if (!notionConnect.replacing) setPendingConnect("notion")
                }
                setNotionConnect(null)
              }}
            >
              Continue to Notion
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Lor will no longer be able to search{" "}
              {disconnectTarget?.name ?? "this connector"}, and its activity
              posts to channels will stop. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (disconnectTarget) {
                  disconnect.mutate(disconnectTarget.connectionId)
                }
                setDisconnectTarget(null)
              }}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ConnectorTile({
  id,
  size = "md",
}: {
  id: ConnectorKey
  size?: "md" | "lg"
}) {
  const Logo = connectorLogo(id)
  return (
    <IconTile size={size}>
      <Logo className={size === "lg" ? "size-7" : "size-5"} />
    </IconTile>
  )
}

function ConnectorList({
  providers,
  query,
  onQueryChange,
  focusId,
  onOpen,
  onConnect,
}: {
  providers: IntegrationStatus[]
  query: string
  onQueryChange: (query: string) => void
  focusId: ConnectorKey | null
  onOpen: (provider: IntegrationStatus) => void
  onConnect: (provider: IntegrationStatus) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Back from a detail view: return focus to the row that opened it.
  useEffect(() => {
    if (!focusId) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-connector="${focusId}"]`)
      ?.focus({ preventScroll: true })
  }, [])

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? providers.filter((p) =>
        `${p.name} ${p.description}`.toLowerCase().includes(needle)
      )
    : providers

  // Points a manager at GitHub while nothing is connected. Opening or
  // connecting any connector counts as getting it.
  const githubRowRef = useRef<HTMLDivElement>(null)
  const github = providers.find((p) => p.id === "github")
  const connectorsHint = useHint(
    "connectors_intro",
    !needle && !!github?.canManage && !providers.some((p) => p.connected)
  )
  const groups = [
    { title: "Connected", providers: matches.filter((p) => p.connected) },
    { title: "Not connected", providers: matches.filter((p) => !p.connected) },
  ].filter((group) => group.providers.length > 0)

  return (
    <div ref={listRef} className="@container space-y-8">
      <InputGroup>
        <InputGroupAddon className="text-muted-foreground">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          size="lg"
          aria-label="Search connectors"
          placeholder="Search connectors"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </InputGroup>
      {groups.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No connectors match “{query.trim()}”.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.title} className="space-y-2">
          <h3 className="px-2.5 text-sm font-medium">
            {group.title}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {group.providers.length}
            </span>
          </h3>
          <div className="grid gap-x-4 gap-y-1 @xl:grid-cols-2">
            {group.providers.map((p) => (
              <ConnectorRow
                key={p.id}
                provider={p}
                rowRef={p.id === "github" ? githubRowRef : undefined}
                onOpen={() => {
                  connectorsHint.dismiss()
                  onOpen(p)
                }}
                onConnect={() => {
                  connectorsHint.dismiss()
                  onConnect(p)
                }}
              />
            ))}
          </div>
        </section>
      ))}
      <HintPopover
        open={connectorsHint.show}
        anchor={githubRowRef}
        side="bottom"
        align="start"
        onDismiss={connectorsHint.dismiss}
      >
        Connect GitHub first. Lor reads pull requests, issues, and code through
        it.
      </HintPopover>
    </div>
  )
}

function ConnectorRow({
  provider: p,
  rowRef,
  onOpen,
  onConnect,
}: {
  provider: IntegrationStatus
  rowRef?: Ref<HTMLDivElement>
  onOpen: () => void
  onConnect: () => void
}) {
  const blocker = connectBlocker(p)
  const activeEvents = p.events.filter((ev) => ev.channelId).length
  const subtitle = p.connected
    ? [
        p.accountLogin ?? "Connected",
        ...(activeEvents > 0
          ? [
              `${activeEvents} ${activeEvents === 1 ? "event" : "events"} active`,
            ]
          : []),
      ].join(" · ")
    : p.description

  return (
    <div
      ref={rowRef}
      className="flex items-center rounded-xl transition-colors hover:bg-accent/50"
    >
      <button
        type="button"
        data-connector={p.id}
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ConnectorTile id={p.id} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {subtitle}
          </span>
        </span>
        {p.connected && (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
        )}
      </button>
      {!p.connected && (
        <Button
          variant="secondary"
          size="sm"
          className={cn(PILL_BUTTON, "mr-2.5 px-3")}
          disabled={!!blocker}
          onClick={onConnect}
        >
          {blocker ?? "Connect"}
        </Button>
      )}
    </div>
  )
}

function ConnectorDetail({
  workspaceSlug,
  provider: p,
  disconnecting,
  onBack,
  onConnect,
  onReconnect,
  onDisconnect,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
  disconnecting: boolean
  onBack: () => void
  onConnect: () => void
  onReconnect: () => void
  onDisconnect: () => void
}) {
  const blocker = connectBlocker(p)
  const status = p.connected
    ? ["Connected", p.accountLogin].filter(Boolean).join(" · ")
    : "Not connected"

  const manageActions = p.canManage ? (
    <>
      {p.id === "notion" && p.connectUrl && (
        <Button
          variant="secondary"
          className={PILL_BUTTON}
          onClick={onReconnect}
        >
          Reconnect
        </Button>
      )}
      <Button
        variant="secondary"
        className={PILL_BUTTON}
        disabled={disconnecting}
        onClick={onDisconnect}
      >
        Disconnect
      </Button>
    </>
  ) : (
    <span className="text-xs text-muted-foreground">Admin managed</span>
  )

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SettingsBackButton label="All connectors" onClick={onBack} />
        <div className="flex items-center gap-4">
          <ConnectorTile id={p.id} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{p.name}</h2>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {p.connected && (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-success"
                />
              )}
              <span className="truncate">{status}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {p.connected ? (
              manageActions
            ) : (
              <Button
                className={PILL_BUTTON}
                disabled={!!blocker}
                onClick={onConnect}
              >
                {blocker ?? "Connect"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{p.description}</p>
      </div>

      {p.connected && p.tools.length > 0 && (
        <ConnectorToolSettings
          key={`${p.connectionId}:${p.enabledTools.join(",")}`}
          workspaceSlug={workspaceSlug}
          provider={p}
        />
      )}

      {!p.connected && p.tools.length > 0 && (
        <ConnectorToolPreview key={p.id} tools={p.tools} />
      )}

      {p.events.length > 0 &&
        (p.connected && p.connectionId ? (
          <EventRoutes
            workspaceSlug={workspaceSlug}
            connectorId={p.id}
            connectionId={p.connectionId}
            events={p.events}
            canManage={p.canManage}
          />
        ) : (
          <SettingsSection
            title="Events"
            count={p.events.length}
            caption={`Connect ${p.name} to send these events to a channel.`}
          >
            <SettingsGroup>
              {p.events.map((ev) => (
                <div key={ev.key} className="py-3 text-sm">
                  {ev.label}
                </div>
              ))}
            </SettingsGroup>
          </SettingsSection>
        ))}

      {p.connected && (
        <Repositories workspaceSlug={workspaceSlug} provider={p} />
      )}
    </div>
  )
}

function EventRoutes({
  workspaceSlug,
  connectorId,
  connectionId,
  events,
  canManage,
}: {
  workspaceSlug: string
  connectorId: ConnectorKey
  connectionId: string
  events: IntegrationStatus["events"]
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const { data: channelsData } = useQuery({
    queryKey: ["channels", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels.$get(
        { param: { workspaceSlug } }
      )
      if (!res.ok) throw new Error("Failed to load channels")
      return res.json()
    },
  })
  const textChannels = [
    ...(channelsData?.uncategorized ?? []),
    ...(channelsData?.categories ?? []).flatMap((cat) => cat.channels),
  ].filter((ch) => ch.type === "text")
  const notifyChannelItems = [
    { value: NOTIFY_OFF, label: "Off" },
    ...textChannels.map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
  ]

  const updateTrigger = useMutation({
    mutationFn: async (input: TriggerConfig & { event: string }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].$patch({
        param: { workspaceSlug, connectionId },
        json: input,
      })
      if (!res.ok) throw new Error("Failed to update event")
    },
    onSuccess: () =>
      // Returned so the mutation stays pending until the refetch lands — `send`
      // composes the full trigger config from cached row data, so editing again
      // before the refetch would overwrite the previous change with stale
      // sibling fields.
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      }),
    onError: () => toast.error("Failed to update event"),
  })
  const pendingEvent = updateTrigger.isPending
    ? updateTrigger.variables.event
    : null
  const activeEvents = events.filter((ev) => ev.channelId).length

  return (
    <SettingsSection
      title="Events"
      count={events.length}
      action={
        activeEvents > 0 && (
          <span className="text-xs text-muted-foreground">
            {activeEvents} active
          </span>
        )
      }
    >
      <SettingsGroup>
        {events.map((ev) => {
          const busy = pendingEvent === ev.key
          // Each change re-sends the full trigger config so one PATCH shape
          // covers channel moves and effect toggles alike.
          const send = (patch: Partial<TriggerConfig>) => {
            updateTrigger.mutate({
              event: ev.key,
              channelId: ev.channelId,
              post: ev.post,
              remember: ev.remember,
              rememberHint: ev.rememberHint,
              actInstructions: ev.actInstructions,
              actWindowSeconds: ev.actWindowSeconds,
              hourlyRunCap: ev.hourlyRunCap,
              dailyRunCap: ev.dailyRunCap,
              ...patch,
            })
          }
          return (
            <div key={ev.key} className="space-y-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{ev.label}</span>
                <Select
                  items={notifyChannelItems}
                  value={ev.channelId ?? NOTIFY_OFF}
                  disabled={busy || !canManage}
                  onValueChange={(value) => {
                    send({ channelId: value === NOTIFY_OFF ? null : value })
                  }}
                >
                  <SelectTrigger className="w-44 shrink-0" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOTIFY_OFF}>Off</SelectItem>
                    {textChannels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        #{ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {ev.channelId && (
                <div className="rounded-lg bg-background">
                  <TriggerEffects
                    idPrefix={`${connectorId}-${ev.key}`}
                    channelLabel={
                      textChannels.find((ch) => ch.id === ev.channelId)?.name
                    }
                    disabled={busy || !canManage}
                    value={{
                      post: ev.post,
                      remember: ev.remember,
                      rememberHint: ev.rememberHint,
                      actInstructions: ev.actInstructions,
                      actWindowSeconds: ev.actWindowSeconds,
                      hourlyRunCap: ev.hourlyRunCap,
                      dailyRunCap: ev.dailyRunCap,
                      lastAct: ev.lastAct,
                    }}
                    onPatch={(patch) => send(patch)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </SettingsGroup>
    </SettingsSection>
  )
}

function Repositories({
  workspaceSlug,
  provider: p,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
}) {
  const repos = p.repos ?? []
  // `repos` may be capped server-side; repoCount is the true total.
  const repoCount = p.repoCount ?? repos.length
  if (repoCount === 0 && !p.manageUrl) return null

  const manageLink = p.manageUrl && (
    <a
      href={p.manageUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      Manage on {p.name}
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        className="size-3"
        strokeWidth={2}
      />
    </a>
  )

  return (
    <>
      <SettingsSection
        title="Repositories"
        count={repoCount}
        action={manageLink}
      >
        <SettingsGroup>
          {repos.length === 0 && (
            <div className="py-3 text-sm text-muted-foreground">
              No repositories yet.
            </div>
          )}
          {repos.slice(0, REPO_DISPLAY_LIMIT).map((r) => (
            <div key={r.fullName} className="flex items-center gap-2 py-2.5">
              <span className="min-w-0 truncate text-sm">{r.fullName}</span>
              {r.private && (
                <HugeiconsIcon
                  icon={SquareLock02Icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                  role="img"
                  aria-label="Private"
                />
              )}
            </div>
          ))}
          {repoCount > REPO_DISPLAY_LIMIT && (
            <div className="py-2.5 text-sm text-muted-foreground">
              +{repoCount - REPO_DISPLAY_LIMIT} more
            </div>
          )}
        </SettingsGroup>
      </SettingsSection>
      {p.id === "github" &&
        p.canManage &&
        p.connectionId &&
        repos.length > 0 && (
          <SettingsSection title="Pull request base branch">
            <SettingsGroup>
              <div className="py-3">
                <GithubBaseBranchSettings
                  workspaceSlug={workspaceSlug}
                  connectionId={p.connectionId}
                  repos={repos}
                />
              </div>
            </SettingsGroup>
          </SettingsSection>
        )}
    </>
  )
}

type DatadogSite = ConnectDatadogRequest["site"]

// Keyed by the API's site union so a new site is a compile error here.
const DATADOG_SITE_LABELS: Record<DatadogSite, string> = {
  "datadoghq.com": "US1 · datadoghq.com",
  "datadoghq.eu": "EU · datadoghq.eu",
  "us3.datadoghq.com": "US3 · us3.datadoghq.com",
  "us5.datadoghq.com": "US5 · us5.datadoghq.com",
  "ap1.datadoghq.com": "AP1 · ap1.datadoghq.com",
  "ap2.datadoghq.com": "AP2 · ap2.datadoghq.com",
}
const DATADOG_SITES = Object.keys(DATADOG_SITE_LABELS) as DatadogSite[]

function DatadogConnectDialog({
  workspaceSlug,
  open,
  onOpenChange,
  onConnected,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const queryClient = useQueryClient()
  const [site, setSite] = useState<DatadogSite>("datadoghq.com")
  const [apiKey, setApiKey] = useState("")
  const [appKey, setAppKey] = useState("")

  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.datadog.connect.$post({
        param: { workspaceSlug },
        json: { site, apiKey: apiKey.trim(), appKey: appKey.trim() },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't connect Datadog")
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Datadog connected")
      setApiKey("")
      setAppKey("")
      onOpenChange(false)
      onConnected()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Datadog</DialogTitle>
          <DialogDescription>
            Paste an API key and an application key with logs read access —
            ideally scoped keys from a service account. They're stored
            encrypted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="datadog-site">Site</Label>
            <Select
              items={DATADOG_SITES.map((s) => ({
                value: s,
                label: DATADOG_SITE_LABELS[s],
              }))}
              value={site}
              onValueChange={(v) => setSite(v as DatadogSite)}
            >
              <SelectTrigger id="datadog-site" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATADOG_SITES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DATADOG_SITE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="datadog-api-key">API key</Label>
            <Input
              id="datadog-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="datadog-app-key">Application key</Label>
            <Input
              id="datadog-app-key"
              type="password"
              autoComplete="off"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={!apiKey.trim() || !appKey.trim() || connect.isPending}
          >
            {connect.isPending && <Spinner className="size-4" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type AwsRegion = ConnectCloudwatchRequest["region"]

// Keyed by the API's region union so a new region is a compile error here.
const AWS_REGION_LABELS: Record<AwsRegion, string> = {
  "us-east-1": "US East (N. Virginia) · us-east-1",
  "us-east-2": "US East (Ohio) · us-east-2",
  "us-west-1": "US West (N. California) · us-west-1",
  "us-west-2": "US West (Oregon) · us-west-2",
  "ca-central-1": "Canada (Central) · ca-central-1",
  "ca-west-1": "Canada West (Calgary) · ca-west-1",
  "mx-central-1": "Mexico (Central) · mx-central-1",
  "eu-west-1": "Europe (Ireland) · eu-west-1",
  "eu-west-2": "Europe (London) · eu-west-2",
  "eu-west-3": "Europe (Paris) · eu-west-3",
  "eu-central-1": "Europe (Frankfurt) · eu-central-1",
  "eu-central-2": "Europe (Zurich) · eu-central-2",
  "eu-north-1": "Europe (Stockholm) · eu-north-1",
  "eu-south-1": "Europe (Milan) · eu-south-1",
  "eu-south-2": "Europe (Spain) · eu-south-2",
  "il-central-1": "Israel (Tel Aviv) · il-central-1",
  "ap-east-1": "Asia Pacific (Hong Kong) · ap-east-1",
  "ap-east-2": "Asia Pacific (Taipei) · ap-east-2",
  "ap-south-1": "Asia Pacific (Mumbai) · ap-south-1",
  "ap-south-2": "Asia Pacific (Hyderabad) · ap-south-2",
  "ap-southeast-1": "Asia Pacific (Singapore) · ap-southeast-1",
  "ap-southeast-2": "Asia Pacific (Sydney) · ap-southeast-2",
  "ap-southeast-3": "Asia Pacific (Jakarta) · ap-southeast-3",
  "ap-southeast-4": "Asia Pacific (Melbourne) · ap-southeast-4",
  "ap-southeast-5": "Asia Pacific (Malaysia) · ap-southeast-5",
  "ap-southeast-7": "Asia Pacific (Thailand) · ap-southeast-7",
  "ap-northeast-1": "Asia Pacific (Tokyo) · ap-northeast-1",
  "ap-northeast-2": "Asia Pacific (Seoul) · ap-northeast-2",
  "ap-northeast-3": "Asia Pacific (Osaka) · ap-northeast-3",
  "af-south-1": "Africa (Cape Town) · af-south-1",
  "me-south-1": "Middle East (Bahrain) · me-south-1",
  "me-central-1": "Middle East (UAE) · me-central-1",
  "sa-east-1": "South America (São Paulo) · sa-east-1",
}
const AWS_REGIONS = Object.keys(AWS_REGION_LABELS) as AwsRegion[]

// One paste-able run for the user (or their agent) with IAM admin access: it
// provisions the read-only IAM user this connector expects — the policy is
// exactly the calls the tools make — and prints the two keys to enter above.
// --no-cli-pager everywhere: the CLI v2 pager would otherwise swallow the
// output and stall the && chain until the user quits less. The awk labels the
// key lines to match the dialog's field names.
const CLOUDWATCH_KEY_COMMAND = `aws iam create-user --user-name lor-cloudwatch --no-cli-pager --output text --query User.Arn && \\
aws iam put-user-policy --user-name lor-cloudwatch --policy-name lor-cloudwatch-readonly --no-cli-pager --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:DescribeLogGroups","logs:StartQuery","logs:GetQueryResults","logs:StopQuery","cloudwatch:ListMetrics","cloudwatch:GetMetricData"],"Resource":"*"}]}' && \\
aws iam create-access-key --user-name lor-cloudwatch --no-cli-pager --output text --query 'AccessKey.[AccessKeyId,SecretAccessKey]' | awk '{print "Access key ID:     " $1; print "Secret access key: " $2}'`

function CloudwatchConnectDialog({
  workspaceSlug,
  open,
  onOpenChange,
  onConnected,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const queryClient = useQueryClient()
  const [region, setRegion] = useState<AwsRegion>("us-east-1")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")

  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.cloudwatch.connect.$post({
        param: { workspaceSlug },
        json: {
          region,
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't connect CloudWatch")
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("CloudWatch connected")
      setAccessKeyId("")
      setSecretAccessKey("")
      onOpenChange(false)
      onConnected()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect CloudWatch</DialogTitle>
          <DialogDescription>
            Paste an access key for a read-only IAM user with CloudWatch logs
            and metrics read access. It's stored encrypted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4 transition-transform group-data-[panel-open]:rotate-180"
              />
              No keys yet? Create them with the AWS CLI
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-1.5 pt-2">
                <CodeBlock
                  id="cloudwatch-provision-keys"
                  code={CLOUDWATCH_KEY_COMMAND}
                  language="bash"
                  lineNumbers="hidden"
                  // min-w-0 so the block fits the dialog instead of forcing
                  // its min-w-80 floor; long lines scroll horizontally.
                  className="min-w-0"
                />
                <p className="text-xs text-muted-foreground">
                  Run this with the AWS CLI (needs IAM admin) — it creates a
                  read-only user and prints the access key ID and secret to
                  paste below.
                </p>
              </div>
            </CollapsiblePanel>
          </Collapsible>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-region">Region</Label>
            <Select
              items={AWS_REGIONS.map((r) => ({
                value: r,
                label: AWS_REGION_LABELS[r],
              }))}
              value={region}
              onValueChange={(v) => setRegion(v as AwsRegion)}
            >
              <SelectTrigger id="cloudwatch-region" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AWS_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {AWS_REGION_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-access-key-id">Access key ID</Label>
            <Input
              id="cloudwatch-access-key-id"
              autoComplete="off"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-secret-access-key">
              Secret access key
            </Label>
            <Input
              id="cloudwatch-secret-access-key"
              type="password"
              autoComplete="off"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={
              !accessKeyId.trim() ||
              !secretAccessKey.trim() ||
              connect.isPending
            }
          >
            {connect.isPending && <Spinner className="size-4" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BetterstackConnectDialog({
  workspaceSlug,
  open,
  onOpenChange,
  onConnected,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const queryClient = useQueryClient()
  const [apiToken, setApiToken] = useState("")
  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.betterstack.connect.$post({
        param: { workspaceSlug },
        json: { apiToken: apiToken.trim() },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Couldn't connect Better Stack")
      }
    },
    onSuccess: async () => {
      setApiToken("")
      await queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Better Stack connected")
      onOpenChange(false)
      onConnected()
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (connect.isPending) return
        if (!value) setApiToken("")
        onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Better Stack</DialogTitle>
          <DialogDescription>
            Investigate errors, logs, and incidents from Lor. Investigation
            tools are enabled by default; state changes can be enabled in tool
            settings.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create an API token in{" "}
            <a
              href="https://betterstack.com/settings/global-api-tokens"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Better Stack settings
            </a>{" "}
            with access to the products you want to investigate. Use a dedicated
            account for your workspace. This is separate from your
            error-reporting DSN and source ingestion tokens.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="betterstack-api-token">API token</Label>
            <Input
              id="betterstack-api-token"
              type="password"
              autoComplete="off"
              value={apiToken}
              disabled={connect.isPending}
              onChange={(event) => setApiToken(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The selected tools will be available to workspace members through
            their assigned agent profiles. Your existing channel alert webhook
            keeps delivering alerts independently.
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={!apiToken.trim() || connect.isPending}
          >
            {connect.isPending && <Spinner className="size-4" />}Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
