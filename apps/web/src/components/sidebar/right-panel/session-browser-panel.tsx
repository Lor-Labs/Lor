import {
  BrowserIcon,
  Copy01Icon,
  Globe02Icon,
  Link01Icon,
  LinkSquare02Icon,
  ReloadIcon,
  Share08Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
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
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionBrowserSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import {
  useSessionBrowserAnnotations,
  useSessionBrowserSharedAnnotations,
} from "@/components/sidebar/right-panel/session-browser-annotations"
import {
  BrowserPresence,
  SessionBrowserLiveView,
  useSessionBrowserLive,
} from "@/components/sidebar/right-panel/session-browser-live-view"
import {
  ASK_LOR_SETUP,
  askLorToFix,
  askLorToFixFile,
  IconButton,
  RunControl,
  ServiceRow,
  useSessionRun,
} from "@/components/sidebar/right-panel/session-browser-run"
import { SessionPanelTabs } from "@/components/sidebar/right-panel/session-changes-panel"
import { useSocket } from "@/context/socket-context"
import { sessionSend } from "@/hooks/use-session-send"
import { apiClient } from "@/lib/api-client"
import { openExternal, openInNewTab } from "@/lib/open-external"
import { readSessionPanel, writeSessionPanel } from "@/lib/session-panel-memory"
import { webOrigin } from "@/lib/web-origin"

// A code session's browser on its sandbox. Sandboxes with the session browser
// (reference/planned/sandbox-browser-runbook.md §4) show the live view of the
// Chromium running there, which people and Lor share; older ones keep the
// port preview iframe (reference/dev-environment-runbook.md §3), where people
// type `localhost:3000/path` and the port's preview URL serves it. Either
// view holds the sandbox awake, so it closes after the page has been hidden a
// while. The toolbar runs the app (session-browser-run.tsx) and shares it: a
// link that opens this browser for teammates, and the page's own preview URL.

const HIDDEN_PAUSE_MS = 2 * 60_000

type Target = { port: number; path: string }

const addressOf = (target: Target) =>
  `localhost:${target.port}${target.path === "/" ? "" : target.path}`

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

// The port's preview URL for a page. `expires`: a private preview, whose
// link carries a short-lived token (15 minutes, sandbox-ports.ts).
async function previewLink(sessionId: string, target: Target) {
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
  return {
    url: `${url}${path}${query ? `${joiner}${query}` : ""}${fragment}`,
    expires: Boolean(query),
  }
}

const previewUrl = async (sessionId: string, target: Target) =>
  (await previewLink(sessionId, target)).url

// Safari only allows a copy that starts in the click itself, so text that
// still has to be fetched is handed over as a promise where that works.
async function copyText(text: Promise<string>) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = text.then(
        (value) => new Blob([value], { type: "text/plain" })
      )
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": blob }),
      ])
      return
    } catch {}
  }
  await navigator.clipboard.writeText(await text)
}

const message = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

export function SessionBrowserPanel({
  view,
}: {
  view: SessionBrowserSidebarView
}) {
  const { sessionId, threadRootId } = view
  const { data: auth } = authClient.useSession()
  const userId = auth?.user.id
  const { setView } = useRightSidebar()
  const socket = useSocket()
  // The last page opened here, kept per session so going back reopens it.
  const [lastTarget, setLastTarget] = useState<Target | null>(
    () => readSessionPanel(userId, sessionId).browser ?? null
  )
  const [address, setAddress] = useState(() =>
    lastTarget ? addressOf(lastTarget) : ""
  )
  // The person can still be loading on the first render: restore once they
  // are known, unless a page was opened meanwhile.
  const hydrated = useRef(Boolean(userId))
  useEffect(() => {
    if (hydrated.current || !userId) return
    hydrated.current = true
    const stored = readSessionPanel(userId, sessionId).browser
    if (!stored) return
    setLastTarget((current) => current ?? stored)
    setAddress((current) => current || addressOf(stored))
  }, [userId, sessionId])
  const [src, setSrc] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  // From a reload or a new page until the frame's load event.
  const [frameLoading, setFrameLoading] = useState(false)
  const [paused, setPaused] = useState(false)

  // Set below: a started service opens once it listens.
  const goTo = useRef<(target: Target) => void>(() => {})
  const run = useSessionRun(sessionId, threadRootId, (port) =>
    goTo.current({ port, path: "/" })
  )

  const open = useMutation({
    mutationFn: (target: Target) => previewUrl(sessionId, target),
    onSuccess: (next) => {
      setSrc(next)
      setFrameLoading(true)
      setPaused(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const live = useSessionBrowserLive(sessionId, threadRootId, run.available)
  const ownAnnotations = useSessionBrowserAnnotations(
    sessionId,
    view.channelId,
    threadRootId,
    live
  )
  const sharedAnnotations = useSessionBrowserSharedAnnotations(
    view.channelId,
    threadRootId,
    live
  )
  const liveMode = run.available && !live.unavailable

  const openPage = useMutation({
    mutationFn: async (target: Target) => {
      const res = await apiClient.v1.sessions[":sessionId"].browser.open.$post({
        param: { sessionId },
        json: target,
      })
      if (!res.ok) throw await failure(res, "Couldn't open that page")
    },
    onError: (err) => toast.error(err.message),
  })

  // Set by any open, so the remembered page never reopens over it.
  const reopened = useRef(false)

  const go = (target: Target) => {
    reopened.current = true
    setAddress(addressOf(target))
    setLastTarget(target)
    writeSessionPanel(userId, sessionId, { browser: target })
    if (liveMode) openPage.mutate(target)
    else open.mutate(target)
  }
  goTo.current = go

  // A terminal link (or another view) asks for a port.
  const requested = view.open
  const handledRequest = useRef<string | null>(null)
  useEffect(() => {
    if (!requested || handledRequest.current === requested.id) return
    handledRequest.current = requested.id
    go({ port: requested.port, path: requested.path })
  }, [requested])

  // Live mode's browser keeps its page in the sandbox; the preview frame
  // reloads the remembered one.
  useEffect(() => {
    if (reopened.current || src || !lastTarget) return
    if (!run.available || !live.unavailable) return
    reopened.current = true
    open.mutate(lastTarget)
  }, [run.available, live.unavailable, lastTarget])

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

  const askLor = async (content: string) => {
    const send = sessionSend(threadRootId)
    if (send?.(content, (error) => toast.error(error))) return
    if (!socket?.connected) {
      toast.error("Connection lost. Try again")
      return
    }
    const result = await socket.timeout(12_000).emitWithAck("message:send", {
      channelId: view.channelId,
      threadRootId,
      content,
      nonce: crypto.randomUUID(),
    })
    if (!result.ok) toast.error(result.error)
  }

  const openTerminal = () =>
    setView({
      type: "session-terminal",
      workspaceSlug: view.workspaceSlug,
      channelId: view.channelId,
      sessionId,
      threadRootId,
    })

  // What "the app" links point at: the sandbox page on screen (Lor may have
  // opened it), else the last one opened here, else whatever runs.
  const onScreen = live.page ? parseAddress(live.page.url) : null
  const running =
    run.services.find(
      (service) => service.default && service.state === "running"
    ) ?? run.ports[0]
  const appTarget: Target | null =
    (liveMode ? onScreen : null) ??
    lastTarget ??
    (running ? { port: running.port, path: "/" } : null)

  // The tab opens in the click, before the preview URL is known: one opened
  // after the request would be a blocked pop-up.
  const openInTab = (target: Target) => {
    const tab = isTauri ? null : window.open("about:blank", "_blank")
    previewUrl(sessionId, target).then(
      (url) => {
        if (isTauri) return openExternal(url)
        if (!tab) {
          toast.error("Your browser blocked the new tab. Copy the link instead")
          return
        }
        tab.opener = null
        tab.location.replace(url)
      },
      (err: unknown) => {
        tab?.close()
        toast.error(message(err, "Couldn't open that port"))
      }
    )
  }

  const share = (
    <ShareMenu
      app={appTarget ? addressOf(appTarget) : null}
      together={liveMode}
      onCopySession={() =>
        copyText(
          Promise.resolve(
            `${webOrigin()}/${view.workspaceSlug}/session/${sessionId}?side=browser`
          )
        ).then(
          () =>
            toast.success(
              live.collab
                ? "Link copied. Teammates who open it see this browser, each other's pointers and notes"
                : "Link copied. Teammates who open it see this browser"
            ),
          () => toast.error("Couldn't copy the link")
        )
      }
      onOpenApp={() => appTarget && openInTab(appTarget)}
      onCopyApp={() => {
        if (!appTarget) return
        const link = previewLink(sessionId, appTarget)
        copyText(link.then((made) => made.url))
          .then(() => link)
          .then(
            (made) =>
              toast.success(
                made.expires
                  ? "Link copied. It opens the app for anyone for the next 15 minutes"
                  : "Link copied. Anyone with it can open the app while the sandbox is awake"
              ),
            (err: unknown) =>
              toast.error(message(err, "Couldn't copy the link"))
          )
      }}
    />
  )

  const runControl = (
    <RunControl
      run={run}
      onOpen={(port) => go({ port, path: "/" })}
      onAskLor={(text) => void askLor(text)}
      onOpenTerminal={openTerminal}
    />
  )

  const body = run.loading ? (
    <BrowserEmpty title="Looking for running servers…" />
  ) : run.noSandbox ? (
    <BrowserEmpty
      title="No sandbox yet"
      text="Send Lor a message in this session to set one up."
    />
  ) : run.failed !== null ? (
    <BrowserEmpty title="Couldn't reach the sandbox" text={run.failed}>
      <Button size="sm" variant="outline" onClick={run.refresh}>
        Try again
      </Button>
    </BrowserEmpty>
  ) : liveMode ? (
    <SessionBrowserLiveView
      live={live}
      annotations={live.collab ? sharedAnnotations : ownAnnotations}
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
      // Light like a new browser tab. A dark-scheme page (JSON and plain text
      // in OS dark mode) then gets its own opaque dark canvas, not white text
      // on this white fill (css-color-adjust: mismatched iframe scheme).
      className="min-h-0 w-full flex-1 border-0 bg-white scheme-light"
      allow="clipboard-read; clipboard-write"
      // Sandbox code must not navigate the app window (no top-navigation).
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
    />
  ) : run.services.length > 0 || run.ports.length > 0 ? (
    <BrowserEmpty
      title={run.services.length > 0 ? "Run the app" : "Open a port"}
      text={
        run.services.length > 0
          ? "Services from .lor/environment.json, and anything else running in the sandbox:"
          : "Servers running in the sandbox:"
      }
    >
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border/70 text-left">
        {run.services.map((service) => (
          <ServiceRow
            key={service.name}
            service={service}
            pending={run.acting(service.name)}
            onStart={() => run.start(service.name)}
            onRestart={() => run.restart(service.name)}
            onStop={() => run.stop(service.name)}
            onOpen={(port) => go({ port, path: "/" })}
            onAskFix={() => void askLor(askLorToFix(service))}
          />
        ))}
        {run.otherPorts.map((entry) => (
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
  ) : run.setupError !== null ? (
    <BrowserEmpty
      title="The run setup is invalid"
      text={`.lor/environment.json: ${run.setupError}`}
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          onClick={() => void askLor(askLorToFixFile(run.setupError ?? ""))}
        >
          Ask Lor to fix it
        </Button>
        <Button size="sm" variant="outline" onClick={openTerminal}>
          Open terminal
        </Button>
      </div>
    </BrowserEmpty>
  ) : (
    <BrowserEmpty
      title="Nothing running yet"
      text="Lor can work out how to run this repo and save it in .lor/environment.json, so next time the app starts from here."
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => void askLor(ASK_LOR_SETUP)}>
          Ask Lor to set up the app
        </Button>
        <Button size="sm" variant="outline" onClick={openTerminal}>
          Open terminal
        </Button>
      </div>
    </BrowserEmpty>
  )

  const header = (
    <RightPanelHeader
      title={<SessionPanelTabs view={view} />}
      workspaceSlug={view.workspaceSlug}
      channelId={view.channelId}
      hideBack
    />
  )

  // The live view shows Chromium's own tabs and address bar, so the toolbar
  // runs the app, shows who is here and shares; who drives and the control
  // toggle sit under the view.
  if (liveMode) {
    return (
      <div className="flex h-full w-full flex-col">
        {header}
        <div className="relative flex shrink-0 items-center gap-2 border-border/70 border-b px-2 py-1.5">
          {runControl}
          <span className="flex-1" />
          {live.collab && (
            <BrowserPresence people={live.people} myId={userId ?? null} />
          )}
          {share}
          {openPage.isPending && <PendingBar />}
        </div>
        {body}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      {header}
      <form
        className="relative flex shrink-0 items-center gap-1.5 border-border/70 border-b px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const target = parseAddress(address)
          if (target) go(target)
          else toast.error("Type a port, like localhost:3000")
        }}
      >
        {runControl}
        <IconButton
          label="Reload"
          icon={ReloadIcon}
          spinning={frameLoading || open.isPending || run.fetching}
          onClick={() => {
            run.refresh()
            if (src) setFrameLoading(true)
            setReloads((n) => n + 1)
          }}
        />
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 transition-colors focus-within:border-ring focus-within:bg-background">
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
        </div>
        <IconButton
          label="Open in a new tab"
          icon={LinkSquare02Icon}
          disabled={!src}
          onClick={() => src && openInNewTab(src)}
        />
        {open.isPending && <PendingBar />}
      </form>
      {body}
    </div>
  )
}

// Two things to share: this browser, for teammates in the workspace to watch,
// point and annotate together, and the app's own preview URL, which opens in
// anyone's browser.
export function ShareMenu({
  app,
  together,
  onCopySession,
  onOpenApp,
  onCopyApp,
}: {
  // `localhost:3000/path`, or null with nothing running to link to.
  app: string | null
  together: boolean
  onCopySession: () => void
  onOpenApp: () => void
  onCopyApp: () => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title="Share the browser or the app"
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2 font-medium text-xs transition-colors hover:bg-foreground/[0.04] data-popup-open:bg-foreground/[0.06]"
      >
        <HugeiconsIcon
          icon={Share08Icon}
          className="size-3.5"
          strokeWidth={2}
        />
        Share
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {together && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>This browser, for teammates</DropdownMenuLabel>
              <DropdownMenuItem onClick={onCopySession}>
                <HugeiconsIcon icon={Link01Icon} strokeWidth={2} />
                Copy link to this browser
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-mono">
            {app ?? "Nothing running yet"}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled={!app} onClick={onOpenApp}>
            <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
            Open in a new tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!app} onClick={onCopyApp}>
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
            Copy link anyone can open
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PendingBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-primary/70"
    />
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
