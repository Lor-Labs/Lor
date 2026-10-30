import {
  ArrowDown01Icon,
  BrowserIcon,
  Globe02Icon,
  LinkSquare02Icon,
  ReloadIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { LorToolEventPayload } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionBrowserSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { SessionPanelTabs } from "@/components/sidebar/right-panel/session-changes-panel"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// A code session's browser on its sandbox (reference/dev-environment-runbook.md
// §3). People type `localhost:3000/path`; behind it is the port's preview URL.
// Ports come from what listens in the sandbox, whoever started the server
// (the terminal, Lor, a script). The iframe holds the sandbox awake, so it
// unmounts after the page has been hidden a while.

const HIDDEN_PAUSE_MS = 2 * 60_000
const TOOL_REFRESH_MS = 1_500
const ASK_LOR =
  "Install the dependencies if needed and start this repo's dev server in the background, bound to 0.0.0.0, so I can open it in the Browser tab. Tell me the port."

const portsKey = (sessionId: string) => ["session-ports", sessionId] as const

type Target = { port: number; path: string }

// `3000`, `localhost:3000/x`, `http://127.0.0.1:3000/x?y` → port and path.
function parseAddress(input: string): Target | null {
  const text = input.trim().replace(/^https?:\/\//, "")
  const match = text.match(
    /^(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):)?(\d{1,5})(\/.*)?$/
  )
  if (!match) return null
  const port = Number(match[1])
  if (port < 1 || port > 65535) return null
  return { port, path: match[2] ?? "/" }
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

export function SessionBrowserPanel({
  view,
}: {
  view: SessionBrowserSidebarView
}) {
  const { sessionId, threadRootId } = view
  const { setView } = useRightSidebar()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const [address, setAddress] = useState("")
  const [src, setSrc] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  // From a reload or a new page until the frame's load event.
  const [frameLoading, setFrameLoading] = useState(false)
  const [paused, setPaused] = useState(false)

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

  const open = useMutation({
    mutationFn: async (target: Target) => {
      const res = await apiClient.v1.sessions[":sessionId"].ports[
        ":port"
      ].open.$post({ param: { sessionId, port: String(target.port) } })
      if (!res.ok) throw await failure(res, "Couldn't open that port")
      const { url, query } = await res.json()
      // The token goes before any #fragment, which never reaches the server.
      const hash = target.path.indexOf("#")
      const path = hash === -1 ? target.path : target.path.slice(0, hash)
      const fragment = hash === -1 ? "" : target.path.slice(hash)
      const joiner = path.includes("?") ? "&" : "?"
      return `${url}${path}${query ? `${joiner}${query}` : ""}${fragment}`
    },
    onSuccess: (next) => {
      setSrc(next)
      setFrameLoading(true)
      setPaused(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const go = (target: Target) => {
    setAddress(
      `localhost:${target.port}${target.path === "/" ? "" : target.path}`
    )
    open.mutate(target)
  }

  // A terminal link (or another view) asks for a port.
  const requested = view.open
  const handledRequest = useRef<string | null>(null)
  useEffect(() => {
    if (!requested || handledRequest.current === requested.id) return
    handledRequest.current = requested.id
    go({ port: requested.port, path: requested.path })
  }, [requested])

  // Lor's tool calls may start a server: refresh the list after a burst.
  useEffect(() => {
    if (!socket) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const onTool = (payload: LorToolEventPayload) => {
      if (payload.threadRootId !== threadRootId || !payload.toolCall.status)
        return
      if (timer) clearTimeout(timer)
      timer = setTimeout(
        () =>
          void queryClient.invalidateQueries({ queryKey: portsKey(sessionId) }),
        TOOL_REFRESH_MS
      )
    }
    socket.on("lor:tool", onTool)
    return () => {
      if (timer) clearTimeout(timer)
      socket.off("lor:tool", onTool)
    }
  }, [socket, queryClient, sessionId, threadRootId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onVisibility = () => {
      if (timer) clearTimeout(timer)
      timer = document.hidden
        ? setTimeout(() => setPaused(true), HIDDEN_PAUSE_MS)
        : null
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const askLor = async () => {
    if (!socket?.connected) {
      toast.error("Connection lost. Try again")
      return
    }
    const result = await socket.timeout(12_000).emitWithAck("message:send", {
      channelId: view.channelId,
      threadRootId,
      content: ASK_LOR,
      nonce: crypto.randomUUID(),
    })
    if (!result.ok) toast.error(result.error)
  }

  const list = ports.data?.ports ?? []
  const currentPort = parseAddress(address)?.port ?? null
  const openTerminal = () =>
    setView({
      type: "session-terminal",
      workspaceSlug: view.workspaceSlug,
      channelId: view.channelId,
      sessionId,
      threadRootId,
    })

  const body = ports.isPending ? (
    <BrowserEmpty title="Looking for running servers…" />
  ) : ports.data && !ports.data.available ? (
    <BrowserEmpty
      title="No sandbox yet"
      text="Send Lor a message in this session to set one up."
    />
  ) : paused ? (
    <BrowserEmpty
      title="Paused"
      text="The page closed while this tab was hidden, so the sandbox can sleep. The server is still running."
    >
      <Button size="sm" variant="outline" onClick={() => setPaused(false)}>
        Resume
      </Button>
    </BrowserEmpty>
  ) : src ? (
    <iframe
      key={`${src}:${reloads}`}
      title="Browser"
      src={src}
      onLoad={() => setFrameLoading(false)}
      className="min-h-0 w-full flex-1 border-0 bg-white"
      allow="clipboard-read; clipboard-write"
      // Sandbox code must not navigate the app window (no top-navigation).
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
    />
  ) : list.length > 0 ? (
    <BrowserEmpty title="Open a port" text="Servers running in the sandbox:">
      <div className="w-full max-w-xs overflow-hidden rounded-lg border border-border/70">
        {list.map((entry) => (
          <button
            key={entry.port}
            type="button"
            onClick={() => go({ port: entry.port, path: "/" })}
            className="flex w-full cursor-pointer items-center gap-2 border-border/70 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-foreground/[0.04]"
          >
            <span className="font-mono">localhost:{entry.port}</span>
            {entry.process && (
              <span className="ml-auto text-muted-foreground text-xs">
                {entry.process}
              </span>
            )}
          </button>
        ))}
      </div>
    </BrowserEmpty>
  ) : (
    <BrowserEmpty
      title="Nothing running yet"
      text="Start the dev server in the terminal, or ask Lor to. Its port shows up here."
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => void askLor()}>
          Ask Lor to start the app
        </Button>
        <Button size="sm" variant="outline" onClick={openTerminal}>
          Open terminal
        </Button>
      </div>
    </BrowserEmpty>
  )

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={<SessionPanelTabs view={view} />}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      <form
        className="relative flex shrink-0 items-center gap-1.5 border-border/70 border-b px-2 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          const target = parseAddress(address)
          if (target) go(target)
          else toast.error("Type a port, like localhost:3000")
        }}
      >
        <ToolbarButton
          label="Reload"
          icon={ReloadIcon}
          spinning={frameLoading || open.isPending || ports.isFetching}
          onClick={() => {
            void ports.refetch()
            if (src) setFrameLoading(true)
            setReloads((n) => n + 1)
          }}
        />
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/70 bg-muted/50 ps-3 pe-1 transition-colors focus-within:border-ring focus-within:bg-background">
          <HugeiconsIcon
            icon={Globe02Icon}
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <input
            aria-label="Address"
            value={address}
            placeholder="localhost:3000"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              title="Open ports"
              className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-muted-foreground text-xs transition-colors hover:bg-foreground/[0.06] hover:text-foreground data-popup-open:bg-foreground/[0.06] data-popup-open:text-foreground"
            >
              <span className="font-mono">{currentPort ?? "Ports"}</span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-3"
                strokeWidth={2}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Open ports</DropdownMenuLabel>
                {list.length === 0 && (
                  <DropdownMenuItem disabled>
                    Nothing listening
                  </DropdownMenuItem>
                )}
                {list.map((entry) => (
                  <DropdownMenuItem
                    key={entry.port}
                    onClick={() => go({ port: entry.port, path: "/" })}
                  >
                    <span className="font-mono">{entry.port}</span>
                    {entry.process && (
                      <span className="ml-auto text-muted-foreground text-xs">
                        {entry.process}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void ports.refetch()}>
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ToolbarButton
          label="Open in your browser"
          icon={LinkSquare02Icon}
          disabled={!src}
          onClick={() => src && openExternal(src)}
        />
        {open.isPending && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-primary/70"
          />
        )}
      </form>
      {body}
    </div>
  )
}

function ToolbarButton({
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
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
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

function BrowserEmpty({
  title,
  text,
  children,
}: {
  title: string
  text?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
        <HugeiconsIcon icon={BrowserIcon} className="size-5" strokeWidth={2} />
      </span>
      <div className="space-y-1">
        <p className="font-medium text-sm">{title}</p>
        {text && (
          <p className="max-w-xs text-muted-foreground text-xs leading-relaxed">
            {text}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
