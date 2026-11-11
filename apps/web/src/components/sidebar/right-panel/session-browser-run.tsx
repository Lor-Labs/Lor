import {
  Alert02Icon,
  ArrowDown01Icon,
  Loading03Icon,
  PlayIcon,
  ReloadIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { LorToolEventPayload } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// Running the app from the Browser tab (reference/planned/sandbox-browser-runbook.md
// §1): the services in the repo's `.lor/environment.json`, each with its
// state and live log, Start / Restart / Stop, and what else listens in the
// sandbox. A dev server in watch mode keeps running after it crashed, so a
// service that stays quiet without listening is shown as stuck with its log
// and "Ask Lor to fix it", never as an endless "Starting".

const TOOL_REFRESH_MS = 1_500
const POLL_MS = 2_000
// Polling keeps the sandbox awake, so it stops for a service that never listens.
const WATCH_MS = 5 * 60_000
// A just-started service can still read as exited from its last run.
const START_GRACE_MS = 4_000
// Its own command runs, prints nothing more and still has no port.
const STUCK_AFTER_MS = 30_000
const LOG_LINES = 40

export type Service = {
  name: string
  command: string
  port: number
  default: boolean
  state: "stopped" | "starting" | "running" | "exited"
  log: string | null
  installing: boolean
  upMs: number | null
  quietMs: number | null
  otherPorts: number[]
  portHeld: boolean
}

export type OpenPort = { port: number; process: string | null }

// What a person needs to know about one service right now.
export type ServiceHealth =
  | "running"
  | "installing"
  | "starting"
  | "stuck"
  | "wrong-port"
  | "exited"
  | "stopped"

export function serviceHealth(service: Service): ServiceHealth {
  if (service.state !== "starting") return service.state
  if (service.installing) return "installing"
  if (service.otherPorts.length > 0) return "wrong-port"
  return (service.quietMs ?? 0) > STUCK_AFTER_MS ? "stuck" : "starting"
}

const NEEDS_HELP: ServiceHealth[] = ["stuck", "wrong-port", "exited"]

const logTail = (log: string | null) =>
  (log ?? "").trimEnd().split("\n").slice(-LOG_LINES).join("\n")

export function askLorToFix(service: Service) {
  const health = serviceHealth(service)
  const what =
    health === "wrong-port"
      ? `listens on port ${service.otherPorts.join(", ")} instead of ${service.port}`
      : health === "stuck"
        ? `started but never listened on port ${service.port}`
        : "stopped"
  return `The ${service.name} service from .lor/environment.json ${what} (\`${service.command}\`). Find out why, fix .lor/environment.json or the code, and start it again. The end of its log:\n\n\`\`\`\n${logTail(service.log)}\n\`\`\``
}

export const askLorToFixFile = (error: string) =>
  `.lor/environment.json is invalid (${error}). Fix it so the Browser tab can start the app.`

export const ASK_LOR_SETUP =
  "Set up this repo to run in the sandbox: install its dependencies, start its dev server in the background and check it answers, then write .lor/environment.json so the Browser tab can start it next time. Tell me the port."

export const portsKey = (sessionId: string) =>
  ["session-ports", sessionId] as const
export const setupKey = (sessionId: string) =>
  ["session-setup", sessionId] as const

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

type ServiceAction = "start" | "restart" | "stop"

async function serviceRequest(
  sessionId: string,
  name: string,
  action: ServiceAction
) {
  const route =
    apiClient.v1.sessions[":sessionId"].setup.services[":name"][action]
  const res = await route.$post({ param: { sessionId, name } })
  if (!res.ok) throw await failure(res, `Couldn't ${action} ${name}`)
}

// `onReady`: the page to show once a started service listens.
export function useSessionRun(
  sessionId: string,
  threadRootId: string,
  onReady: (port: number) => void
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  // The service a Start click waits for, to open it once it listens.
  const [opening, setOpening] = useState<{ name: string; at: number } | null>(
    null
  )
  // Poll until then: set by every start, and while the services are open.
  const [watchUntil, setWatchUntil] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const ready = useRef(onReady)
  ready.current = onReady

  const ports = useQuery({
    queryKey: portsKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].ports.$get({
        param: { sessionId },
      })
      if (!res.ok) throw await failure(res, "Couldn't read the open ports")
      return res.json()
    },
  })

  const setup = useQuery({
    queryKey: setupKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].setup.$get({
        param: { sessionId },
      })
      if (!res.ok) throw await failure(res, "Couldn't read the run setup")
      return res.json()
    },
    refetchInterval: (query) => {
      const data = query.state.data
      const starting =
        data?.status === "ready" &&
        data.services.some((service) => service.state === "starting")
      if (menuOpen && starting) return POLL_MS
      return Date.now() < watchUntil && (opening !== null || starting)
        ? POLL_MS
        : false
    },
  })
  const services: Service[] =
    setup.data?.status === "ready" ? setup.data.services : []
  const setupError =
    setup.data?.status === "invalid" ? (setup.data.error ?? "unreadable") : null

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: portsKey(sessionId) })
    void queryClient.invalidateQueries({ queryKey: setupKey(sessionId) })
  }

  const act = useMutation({
    mutationFn: async (items: { name: string; action: ServiceAction }[]) => {
      await Promise.all(
        items.map((item) => serviceRequest(sessionId, item.name, item.action))
      )
    },
    onMutate: (items) => {
      if (items.some((item) => item.action !== "stop")) {
        setWatchUntil(Date.now() + WATCH_MS)
      }
    },
    onSuccess: (_result, items) => {
      const started = items.find((item) => item.action !== "stop")
      setOpening(started ? { name: started.name, at: Date.now() } : null)
      refresh()
    },
    onError: (err) => {
      toast.error(err.message)
      refresh()
    },
  })
  const acting = (name: string) =>
    act.isPending && act.variables?.some((item) => item.name === name) === true

  // "The app": every service not marked `default: false`.
  const app = services.filter((service) => service.default)
  const appDown = app.filter((service) =>
    ["stopped", "exited", "stuck", "wrong-port"].includes(
      serviceHealth(service)
    )
  )
  // Start app: the stopped ones start, the stuck ones start over. The page
  // opens on the app's first service that this started.
  const startApp = () =>
    act.mutate(
      appDown.map((service) => ({
        name: service.name,
        action: service.state === "starting" ? "restart" : "start",
      }))
    )

  useEffect(() => {
    if (!opening) return
    const service = services.find((s) => s.name === opening.name)
    const age = Date.now() - opening.at
    if (service?.state === "running") {
      setOpening(null)
      void queryClient.invalidateQueries({ queryKey: portsKey(sessionId) })
      ready.current(service.port)
    } else if (
      ((!service || service.state === "exited") && age > START_GRACE_MS) ||
      (service && NEEDS_HELP.includes(serviceHealth(service))) ||
      age > WATCH_MS
    ) {
      setOpening(null)
      // It needs a look: its log is in the services list.
      if (service && age > START_GRACE_MS) setMenuOpen(true)
    }
  }, [opening, setup.data, setup.dataUpdatedAt])

  // Lor's tool calls may start a server or write the setup file: refresh
  // after a burst.
  useEffect(() => {
    if (!socket) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const onTool = (payload: LorToolEventPayload) => {
      if (payload.threadRootId !== threadRootId || !payload.toolCall.status)
        return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: portsKey(sessionId) })
        void queryClient.invalidateQueries({ queryKey: setupKey(sessionId) })
      }, TOOL_REFRESH_MS)
    }
    socket.on("lor:tool", onTool)
    return () => {
      if (timer) clearTimeout(timer)
      socket.off("lor:tool", onTool)
    }
  }, [socket, queryClient, sessionId, threadRootId])

  const list: OpenPort[] = ports.data?.ports ?? []
  const troubled = app.filter((service) =>
    NEEDS_HELP.includes(serviceHealth(service))
  )
  const busy =
    opening !== null ||
    act.isPending ||
    app.some((service) =>
      ["starting", "installing"].includes(serviceHealth(service))
    )
  // One word for the toolbar.
  const summary: RunSummary =
    services.length === 0
      ? setupError !== null
        ? "invalid"
        : list.length > 0
          ? "ports"
          : "none"
      : troubled.length > 0
        ? "trouble"
        : busy
          ? "starting"
          : appDown.length > 0 || !services.some((s) => s.state === "running")
            ? "stopped"
            : "running"

  return {
    available: ports.data?.available === true,
    noSandbox: ports.data?.available === false,
    // The sandbox couldn't be read at all.
    failed: ports.isError ? ports.error.message : null,
    loading: ports.isPending,
    fetching: ports.isFetching || setup.isFetching,
    ports: list,
    otherPorts: list.filter(
      (entry) => !services.some((service) => service.port === entry.port)
    ),
    services,
    setupError,
    summary,
    troubled,
    canStartApp: appDown.length > 0,
    starting: busy,
    startApp,
    start: (name: string) => act.mutate([{ name, action: "start" }]),
    restart: (name: string) => act.mutate([{ name, action: "restart" }]),
    stop: (name: string) => act.mutate([{ name, action: "stop" }]),
    stopAll: () =>
      act.mutate(
        services
          .filter((service) => service.state !== "stopped")
          .map((service) => ({ name: service.name, action: "stop" as const }))
      ),
    acting,
    refresh,
    menuOpen,
    setMenuOpen,
  }
}

export type RunSummary =
  | "none"
  | "invalid"
  | "ports"
  | "stopped"
  | "starting"
  | "trouble"
  | "running"

export type SessionRun = ReturnType<typeof useSessionRun>

const DOT: Record<ServiceHealth, string> = {
  running: "bg-success",
  installing: "bg-warning animate-pulse motion-reduce:animate-none",
  starting: "bg-warning animate-pulse motion-reduce:animate-none",
  stuck: "bg-destructive",
  "wrong-port": "bg-destructive",
  exited: "bg-destructive",
  stopped: "bg-muted-foreground/40",
}

const seconds = (ms: number | null) => Math.max(1, Math.round((ms ?? 0) / 1000))

function healthLine(service: Service, health: ServiceHealth): string {
  switch (health) {
    case "running":
      return `localhost:${service.port}`
    case "installing":
      return `Installing, ${seconds(service.upMs)} s`
    case "starting":
      return `Starting, ${seconds(service.upMs)} s`
    case "stuck":
      return `Nothing on port ${service.port} yet`
    case "wrong-port":
      return `On port ${service.otherPorts.join(", ")}, not ${service.port}`
    case "exited":
      return "Stopped with an error"
    case "stopped":
      return "Not running"
  }
}

function healthDetail(service: Service, health: ServiceHealth): string | null {
  if (health === "stuck") {
    return `No output for ${seconds(service.quietMs)} s and nothing listens on port ${service.port}. A dev server in watch mode stays up after it crashed.`
  }
  if (health === "wrong-port") {
    return `.lor/environment.json says port ${service.port}, so the Browser tab can't open it.`
  }
  if (service.portHeld && health !== "running") {
    return `The sandbox still holds port ${service.port} from an earlier server bound to 0.0.0.0. A server that binds every address (::) fails there with EADDRINUSE.`
  }
  return null
}

// The app's state in the toolbar, with every service and port behind it.
export function RunControl({
  run,
  onOpen,
  onAskLor,
  onOpenTerminal,
}: {
  run: SessionRun
  onOpen: (port: number) => void
  onAskLor: (text: string) => void
  onOpenTerminal: () => void
}) {
  const { summary, services } = run
  const trouble = run.troubled[0]
  const label =
    summary === "running"
      ? "Running"
      : summary === "starting"
        ? services.some((service) => serviceHealth(service) === "installing")
          ? "Installing"
          : "Starting"
        : summary === "trouble"
          ? `${trouble?.name ?? "A service"} needs a look`
          : summary === "invalid"
            ? "Run setup invalid"
            : summary === "ports"
              ? "Ports"
              : summary === "stopped"
                ? "Stopped"
                : "No app yet"
  const ask = (text: string) => {
    run.setMenuOpen(false)
    onAskLor(text)
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={run.menuOpen} onOpenChange={run.setMenuOpen}>
        <PopoverTrigger
          title="The app's services and ports"
          className={cn(
            "flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs transition-colors hover:bg-foreground/[0.04] data-popup-open:bg-foreground/[0.06]",
            summary === "trouble" || summary === "invalid"
              ? "text-destructive-foreground"
              : "text-foreground"
          )}
        >
          <SummaryMark summary={summary} />
          <span className="truncate font-medium">{label}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
        </PopoverTrigger>
        <PopoverPopup
          align="start"
          className="w-[22rem] max-w-[calc(100vw-2rem)]"
          viewportClassName="p-0 [--viewport-inline-padding:0px]"
        >
          <div className="flex max-h-[min(32rem,var(--available-height,70vh))] flex-col">
            <div className="flex items-center gap-2 border-border/70 border-b px-3 py-2">
              <p className="flex-1 font-medium text-sm">App</p>
              {run.canStartApp && (
                <Button
                  size="xs"
                  disabled={run.starting}
                  onClick={run.startApp}
                >
                  Start app
                </Button>
              )}
              {services.some((service) => service.state !== "stopped") && (
                <Button size="xs" variant="ghost" onClick={run.stopAll}>
                  Stop all
                </Button>
              )}
              <IconButton
                label="Refresh"
                icon={ReloadIcon}
                spinning={run.fetching}
                onClick={run.refresh}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {services.map((service) => (
                <ServiceRow
                  key={service.name}
                  service={service}
                  pending={run.acting(service.name)}
                  onStart={() => run.start(service.name)}
                  onRestart={() => run.restart(service.name)}
                  onStop={() => run.stop(service.name)}
                  onOpen={(port) => {
                    run.setMenuOpen(false)
                    onOpen(port)
                  }}
                  onAskFix={() => ask(askLorToFix(service))}
                />
              ))}
              {services.length === 0 && (
                <div className="space-y-2.5 px-3 py-3">
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {run.setupError !== null
                      ? `.lor/environment.json is invalid: ${run.setupError}`
                      : "This repo has no .lor/environment.json yet. Lor can work out how to run it and save that, so the app starts from here next time."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="xs"
                      onClick={() =>
                        ask(
                          run.setupError !== null
                            ? askLorToFixFile(run.setupError)
                            : ASK_LOR_SETUP
                        )
                      }
                    >
                      {run.setupError !== null
                        ? "Ask Lor to fix it"
                        : "Ask Lor to set up the app"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        run.setMenuOpen(false)
                        onOpenTerminal()
                      }}
                    >
                      Open terminal
                    </Button>
                  </div>
                </div>
              )}
              {run.otherPorts.length > 0 && (
                <div className="border-border/70 border-t py-1.5">
                  <p className="px-3 py-1 text-[11px] text-muted-foreground">
                    Other ports listening in the sandbox
                  </p>
                  {run.otherPorts.map((entry) => (
                    <button
                      key={entry.port}
                      type="button"
                      onClick={() => {
                        run.setMenuOpen(false)
                        onOpen(entry.port)
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.04]"
                    >
                      <span className="font-mono">localhost:{entry.port}</span>
                      {entry.process && (
                        <span className="text-muted-foreground">
                          {entry.process}
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground">
                        Open
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      {summary === "stopped" && run.canStartApp && (
        <Button size="xs" onClick={run.startApp}>
          <HugeiconsIcon icon={PlayIcon} className="size-3" strokeWidth={2} />
          Start app
        </Button>
      )}
    </div>
  )
}

function SummaryMark({ summary }: { summary: RunSummary }) {
  if (summary === "starting") {
    return (
      <HugeiconsIcon
        icon={Loading03Icon}
        className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        strokeWidth={2}
      />
    )
  }
  if (summary === "trouble" || summary === "invalid") {
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        className="size-3 shrink-0"
        strokeWidth={2}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        summary === "running" ? "bg-success" : "bg-muted-foreground/40"
      )}
    />
  )
}

export function ServiceRow({
  service,
  pending,
  onStart,
  onRestart,
  onStop,
  onOpen,
  onAskFix,
}: {
  service: Service
  pending: boolean
  onStart: () => void
  onRestart: () => void
  onStop: () => void
  onOpen: (port: number) => void
  onAskFix: () => void
}) {
  const health = serviceHealth(service)
  const working = health === "starting" || health === "installing"
  const needsHelp = NEEDS_HELP.includes(health)
  // The log shows itself while it matters; a running service's is a click away.
  const [logOpen, setLogOpen] = useState(false)
  const showLog = (working || needsHelp || logOpen) && service.log !== null
  const detail = healthDetail(service, health)
  const log = useRef<HTMLPreElement | null>(null)
  const tail = logTail(service.log)
  // Follows the newest output, like a terminal.
  useEffect(() => {
    if (showLog && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [showLog, tail])

  return (
    <div className="border-border/70 border-b px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", DOT[health])}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5 text-sm">
            <span className="truncate font-medium">{service.name}</span>
            {!service.default && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                optional
              </span>
            )}
          </p>
          <p
            className={cn(
              "truncate text-xs",
              health === "running" && "font-mono",
              needsHelp
                ? "text-destructive-foreground"
                : "text-muted-foreground"
            )}
          >
            {healthLine(service, health)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {pending ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              className="mx-1.5 size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
              strokeWidth={2}
            />
          ) : health === "stopped" ? (
            <Button size="xs" variant="outline" onClick={onStart}>
              Start
            </Button>
          ) : (
            <>
              {health === "running" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onOpen(service.port)}
                >
                  Open
                </Button>
              )}
              <IconButton
                label={`Restart ${service.name}`}
                icon={ReloadIcon}
                onClick={onRestart}
              />
              {health !== "exited" && (
                <IconButton
                  label={`Stop ${service.name}`}
                  icon={StopIcon}
                  onClick={onStop}
                />
              )}
            </>
          )}
        </div>
      </div>
      {detail && (
        <p className="mt-1.5 pl-3.5 text-muted-foreground text-xs leading-relaxed">
          {detail}
        </p>
      )}
      {showLog && (
        <pre
          ref={log}
          className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 font-mono text-[11px] text-muted-foreground leading-relaxed"
        >
          {tail || "No output yet."}
        </pre>
      )}
      {(needsHelp || (health === "running" && service.log !== null)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-3.5">
          {needsHelp && (
            <Button size="xs" onClick={onAskFix}>
              Ask Lor to fix it
            </Button>
          )}
          {health === "wrong-port" &&
            service.otherPorts.map((port) => (
              <Button
                key={port}
                size="xs"
                variant="outline"
                onClick={() => onOpen(port)}
              >
                Open {port}
              </Button>
            ))}
          {health === "running" && (
            <button
              type="button"
              onClick={() => setLogOpen(!logOpen)}
              className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {logOpen ? "Hide log" : "Show log"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function IconButton({
  label,
  icon,
  disabled,
  spinning,
  onClick,
}: {
  label: string
  icon: IconSvgElement
  disabled?: boolean
  spinning?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <HugeiconsIcon
        icon={icon}
        className={cn(
          "size-3.5",
          spinning && "animate-spin motion-reduce:animate-none"
        )}
        strokeWidth={2}
      />
    </button>
  )
}
