import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Comment01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type RFB from "@novnc/novnc"
import { authClient } from "@repo/auth/client"
import type { LorToolEventPayload } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { browserStep } from "@repo/utils/browser-step"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import {
  type SessionBrowserComments,
  SessionBrowserCommentsCard,
} from "@/components/sidebar/right-panel/session-browser-comments"
import { attachBrowserKeys } from "@/components/sidebar/right-panel/session-browser-keys"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// The session browser's live view (reference/planned/sandbox-browser-runbook.md
// §4): noVNC on the sandbox's gateway, in a 16:10 frame with who drives on it
// and one Take control / Hand back toggle under it. Each connection needs a
// fresh one-time token, so every reconnect asks the API again. The gateway
// closes a viewer whose role changed, and the view reconnects in its new
// role. A hidden page disconnects, since live traffic keeps the sandbox awake
// and billed. Lor's `lor-browser` commands show as a live caption.

export type BrowserController = { userId: string; name: string } | null

const RETRY_MS = [300, 1000, 2000, 5000, 10_000]
const HIDDEN_PAUSE_MS = 2 * 60_000
// How long Lor's last browser step stays on the caption after it finished.
const STEP_FRESH_MS = 8_000
// Give up on showing "Switching control…" if the reconnect never lands.
const SWITCH_TIMEOUT_MS = 10_000

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return body?.message ?? fallback
}

// "Ran lor-browser open http://localhost:3000" → "Opened localhost:3000".
function lorBrowserCaption(label: string): string | null {
  if (!label.startsWith("Ran ")) return null
  const step = browserStep(label.slice(4))
  if (!step) return null
  return step.target ? `${step.verb} ${step.target}` : step.verb
}

export function useSessionBrowserLive(
  sessionId: string,
  threadRootId: string,
  enabled: boolean
) {
  const socket = useSocket()
  const { data: auth } = authClient.useSession()
  const myId = auth?.user.id ?? null
  const [screen, setScreen] = useState<HTMLDivElement | null>(null)
  const [connected, setConnected] = useState(false)
  const [everConnected, setEverConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [role, setRole] = useState<"control" | "watch">("watch")
  const [controller, setController] = useState<BrowserController>(null)
  const [switching, setSwitching] = useState(false)
  const [lorStep, setLorStep] = useState<{
    text: string
    running: boolean
  } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)

  useEffect(() => {
    if (!enabled || !screen || paused || unavailable || failed) return
    let cancelled = false
    let rfb: RFB | null = null
    let detachKeys: (() => void) | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const retryLater = (message: string) => {
      const delay = RETRY_MS[failures.current]
      failures.current += 1
      if (delay === undefined) setFailed(message)
      else retry = setTimeout(() => setAttempt((n) => n + 1), delay)
    }
    const connect = async () => {
      const res = await apiClient.v1.sessions[":sessionId"].browser.$post({
        param: { sessionId },
      })
      if (cancelled) return
      if (!res.ok) {
        retryLater(await errorMessage(res, "Couldn't open the browser"))
        return
      }
      const view = await res.json()
      if (cancelled) return
      if (view.status === "unavailable") {
        setUnavailable(true)
        return
      }
      setRole(view.role)
      setController(view.controller)
      // Loaded on first use: noVNC stays out of the app's main bundle.
      const { default: Rfb } = await import("@novnc/novnc")
      if (cancelled) return
      rfb = new Rfb(screen, view.url)
      rfb.scaleViewport = true
      rfb.viewOnly = view.role === "watch"
      rfb.focusOnClick = view.role === "control"
      rfb.background = "transparent"
      if (view.role === "control") detachKeys = attachBrowserKeys(screen, rfb)
      rfb.addEventListener("connect", () => {
        failures.current = 0
        setConnected(true)
        setEverConnected(true)
        setSwitching(false)
      })
      rfb.addEventListener("disconnect", () => {
        setConnected(false)
        if (!cancelled) retryLater("The live view disconnected")
      })
    }
    connect().catch((err: unknown) => {
      if (cancelled) return
      retryLater(err instanceof Error ? err.message : "Couldn't open it")
    })
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      detachKeys?.()
      rfb?.disconnect()
      setConnected(false)
    }
  }, [enabled, screen, paused, unavailable, failed, attempt, sessionId])

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

  useEffect(() => {
    if (!socket) return
    const onControl = (payload: {
      sessionId: string
      controller: BrowserController
    }) => {
      if (payload.sessionId === sessionId) setController(payload.controller)
    }
    socket.on("session:browser:control", onControl)
    return () => {
      socket.off("session:browser:control", onControl)
    }
  }, [socket, sessionId])

  // Lor's browser steps, live: shown while one runs and briefly after.
  useEffect(() => {
    if (!socket) return
    let fade: ReturnType<typeof setTimeout> | null = null
    const onTool = (payload: LorToolEventPayload) => {
      if (payload.threadRootId !== threadRootId) return
      if (payload.toolCall.toolName !== "bash") return
      const text = lorBrowserCaption(payload.toolCall.label)
      if (!text) return
      const running = !payload.toolCall.status
      setLorStep({ text, running })
      if (fade) clearTimeout(fade)
      fade = running ? null : setTimeout(() => setLorStep(null), STEP_FRESH_MS)
    }
    socket.on("lor:tool", onTool)
    return () => {
      if (fade) clearTimeout(fade)
      socket.off("lor:tool", onTool)
    }
  }, [socket, threadRootId])

  useEffect(() => {
    if (!switching) return
    const timer = setTimeout(() => setSwitching(false), SWITCH_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [switching])

  const control = useMutation({
    mutationFn: async (take: boolean) => {
      const res = await apiClient.v1.sessions[
        ":sessionId"
      ].browser.control.$post({ param: { sessionId }, json: { take } })
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Couldn't change control"))
      }
      return res.json()
    },
    onMutate: () => setSwitching(true),
    onSuccess: (result) => setController(result.controller),
    onError: (err) => {
      setSwitching(false)
      toast.error(err.message)
    },
  })

  // Right after taking control the view is still reconnecting as a viewer.
  const youControl =
    role === "control" || (myId !== null && controller?.userId === myId)

  return {
    setScreen,
    connected,
    everConnected,
    paused,
    unavailable,
    failed,
    controller,
    youControl,
    otherControls: controller !== null && !youControl,
    switching: switching || control.isPending,
    lorStep,
    expanded,
    setExpanded,
    takeControl: () => control.mutate(true),
    takeControlAsync: async () => {
      await control.mutateAsync(true)
    },
    handBack: () => control.mutate(false),
    resume: () => {
      failures.current = 0
      setPaused(false)
      setFailed(null)
      setAttempt((n) => n + 1)
    },
  }
}

export type SessionBrowserLive = ReturnType<typeof useSessionBrowserLive>

export function SessionBrowserLiveView({
  live,
  comments,
}: {
  live: SessionBrowserLive
  comments?: SessionBrowserComments
}) {
  const { expanded, setExpanded, youControl } = live

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded, setExpanded])

  const center = live.paused ? (
    <FrameMessage text="Paused while this tab was hidden, so the sandbox can sleep. The app keeps running.">
      <Button size="sm" variant="outline" onClick={live.resume}>
        Resume
      </Button>
    </FrameMessage>
  ) : live.failed ? (
    <FrameMessage text={live.failed}>
      <Button size="sm" variant="outline" onClick={live.resume}>
        Reconnect
      </Button>
    </FrameMessage>
  ) : !live.everConnected ? (
    <FrameMessage
      text="Starting the browser…"
      detail="The first start takes a few seconds."
      spinner
    />
  ) : null
  const corner = live.switching
    ? "Switching control…"
    : live.everConnected && !live.connected && !live.paused && !live.failed
      ? "Reconnecting…"
      : null

  // The same nodes in both sizes, so noVNC keeps its connection and rescales.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes the expanded view (window listener above); the backdrop click is a mouse shortcut for it
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2.5",
        expanded
          ? "fade-in fixed inset-0 z-50 animate-in bg-black/60 p-6 backdrop-blur-sm duration-200"
          : "p-3"
      )}
      onClick={(event) => {
        // Clicking around the view closes it, except while you drive.
        if (expanded && !youControl && event.target === event.currentTarget) {
          setExpanded(false)
        }
      }}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
        <div
          className={cn(
            "relative aspect-[16/10] w-[min(100cqw,calc(100cqh*1.6))] overflow-hidden rounded-lg border border-border/70 bg-muted/40 shadow-xs transition-shadow duration-200",
            youControl && "ring-2 ring-primary"
          )}
        >
          <div ref={live.setScreen} className="absolute inset-0" />
          {center}
          {corner && (
            <FramePill className="absolute top-2 left-2">
              <HugeiconsIcon
                icon={Loading03Icon}
                className="size-3 animate-spin motion-reduce:animate-none"
                strokeWidth={2}
              />
              {corner}
            </FramePill>
          )}
          <button
            type="button"
            // While you drive, Esc goes to the page (noVNC takes it).
            title={expanded ? "Shrink" : "Expand"}
            aria-label={expanded ? "Shrink the browser" : "Expand the browser"}
            onClick={() => setExpanded(!expanded)}
            className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-md bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <HugeiconsIcon
              icon={expanded ? ArrowShrink02Icon : ArrowExpand01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
          </button>
          <DriverPill live={live} />
        </div>
      </div>
      {comments && <SessionBrowserCommentsCard comments={comments} />}
      <BrowserFooter live={live} comments={comments} />
    </div>
  )
}

// Who drives, on the frame: you (primary), someone else, or Lor at work.
function DriverPill({ live }: { live: SessionBrowserLive }) {
  if (live.youControl) {
    return (
      <span className="absolute right-2 bottom-2 rounded-full bg-primary px-2.5 py-1 font-medium text-[11px] text-primary-foreground shadow-sm">
        You have control
      </span>
    )
  }
  const text = live.controller
    ? `${live.controller.name} has control`
    : live.lorStep
      ? "Lor"
      : null
  if (!text) return null
  return (
    <FramePill className="absolute right-2 bottom-2">
      {!live.controller && <LiveDot />}
      {text}
    </FramePill>
  )
}

// The status line, Comment and the one control toggle under the frame.
function BrowserFooter({
  live,
  comments,
}: {
  live: SessionBrowserLive
  comments?: SessionBrowserComments
}) {
  const commenting =
    comments !== undefined && (comments.picking || comments.comments.length > 0)
  const status = live.switching
    ? "Switching control…"
    : live.youControl
      ? "You have control. Lor waits until you hand it back."
      : live.controller
        ? `${live.controller.name} has control.`
        : live.lorStep
          ? `Lor is using the browser · ${live.lorStep.text}`
          : "Watching"
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2",
        live.expanded &&
          "mx-auto w-full max-w-3xl rounded-lg bg-popover px-3 py-2 text-popover-foreground shadow-lg"
      )}
    >
      {live.lorStep && !live.controller && !live.youControl && <LiveDot />}
      <p className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
        {status}
      </p>
      {comments && !commenting && (
        <Button
          size="sm"
          variant="outline"
          title="Pick elements on the page and tell Lor what to change"
          disabled={live.switching || live.unavailable || !live.everConnected}
          onClick={comments.pick}
        >
          <HugeiconsIcon
            icon={Comment01Icon}
            className="size-3.5"
            strokeWidth={2}
          />
          Comment
        </Button>
      )}
      <Button
        size="sm"
        variant={live.youControl ? "default" : "outline"}
        disabled={live.switching || live.unavailable || !live.everConnected}
        onClick={live.youControl ? live.handBack : live.takeControl}
      >
        {live.youControl
          ? "Hand back"
          : live.otherControls
            ? "Take over"
            : "Take control"}
      </Button>
    </div>
  )
}

function FramePill({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-medium text-[11px] text-white backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  )
}

function LiveDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none"
    />
  )
}

function FrameMessage({
  text,
  detail,
  spinner,
  children,
}: {
  text: string
  detail?: string
  spinner?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 px-8 text-center">
      <div className="space-y-1">
        <p className="flex items-center justify-center gap-2 font-medium text-sm">
          {spinner && (
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
              strokeWidth={2}
            />
          )}
          {text}
        </p>
        {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
      </div>
      {children}
    </div>
  )
}
