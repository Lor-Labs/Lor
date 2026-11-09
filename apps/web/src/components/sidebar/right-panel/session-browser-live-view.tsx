import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  CursorEdit02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type { LorToolEventPayload } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { browserStep, needsBrowserControl } from "@repo/utils/browser-step"
import { useMutation } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import type { SessionBrowserAnnotations } from "@/components/sidebar/right-panel/session-browser-annotations"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// The session browser's live view (reference/planned/sandbox-browser-runbook.md
// §4): Selkies' page from the sandbox's gateway in an iframe, filling the
// panel, with who drives on it and one Take control / Hand back toggle under
// it. The person in control's view sizes the sandbox's display. The gateway's
// bridge script in the page posts who has control and the controller's input
// (Lor's idle hand-back), and reloads the page when its role changes. A
// hidden page unloads, since live traffic keeps the sandbox awake and
// billed. Lor's `lor-browser` commands show as a live caption.

export type BrowserController = { userId: string; name: string } | null

type BridgeMessage =
  | {
      source: "lor-browser"
      type: "control"
      role: "control" | "watch"
      controller: BrowserController
    }
  | { source: "lor-browser"; type: "freeze"; image: string | null }
  | {
      source: "lor-browser"
      type: "input" | "disconnected" | "expired" | "picture"
    }

const RETRY_MS = [300, 1000, 2000, 5000, 10_000]
const HIDDEN_PAUSE_MS = 2 * 60_000
// The page never reported in: load it again with a new grant.
const LOAD_TIMEOUT_MS = 30_000
// How long Lor's last browser step stays on the caption after it finished.
const STEP_FRESH_MS = 8_000
// Give up on showing "Switching control…" if the reload never lands.
const SWITCH_TIMEOUT_MS = 10_000
// A switch that lands sooner shows no "Switching control…" at all.
const SWITCH_NOTICE_MS = 700
// The last picture covers the page's reload until its first frame, at most this.
const FREEZE_MAX_MS = 8_000
// Lor asked for the browser: the controller's idle time before it goes back.
const IDLE_HAND_BACK_MS = 15_000
// lor-browser gives up waiting for control after CONTROL_WAIT_SECONDS (45 s):
// a request whose finish never arrived lapses just after.
const LOR_WAIT_MS = 50_000

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
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [everConnected, setEverConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [role, setRole] = useState<"control" | "watch">("watch")
  const [controller, setController] = useState<BrowserController>(null)
  const [switching, setSwitching] = useState(false)
  const [slowSwitch, setSlowSwitch] = useState(false)
  // The picture from before a role-change reload, shown over the page.
  const [frozen, setFrozen] = useState<string | null>(null)
  const [lorStep, setLorStep] = useState<{
    text: string
    running: boolean
  } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)
  // Lor's running command that waits for a person to hand the browser back.
  const [lorWaiting, setLorWaiting] = useState<string | null>(null)
  const [kept, setKept] = useState<string | null>(null)
  const [handBackIn, setHandBackIn] = useState<number | null>(null)
  // Annotating: the idle hand-back waits until the notes are sent or discarded.
  const [held, setHeld] = useState(false)
  const lastInputAt = useRef(Date.now())

  // Each load asks the API for a new grant; the page then reconnects on its
  // own until the grant lapses.
  useEffect(() => {
    if (!enabled || paused || unavailable || failed) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const retryLater = (message: string) => {
      const delay = RETRY_MS[failures.current]
      failures.current += 1
      if (delay === undefined) setFailed(message)
      else retry = setTimeout(() => setAttempt((n) => n + 1), delay)
    }
    const load = async () => {
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
      setUrl(view.url)
      retry = setTimeout(
        () => retryLater("The live view didn't load"),
        LOAD_TIMEOUT_MS
      )
    }
    load().catch((err: unknown) => {
      if (cancelled) return
      retryLater(err instanceof Error ? err.message : "Couldn't open it")
    })
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const msg = event.data as BridgeMessage
      if (msg?.source !== "lor-browser") return
      if (msg.type === "control") {
        if (retry) clearTimeout(retry)
        failures.current = 0
        setRole(msg.role)
        setController(msg.controller)
        setConnected(true)
        setEverConnected(true)
        setSwitching(false)
      } else if (msg.type === "freeze") {
        if (msg.image) setFrozen(msg.image)
      } else if (msg.type === "picture") {
        setFrozen(null)
      } else if (msg.type === "input") {
        lastInputAt.current = Date.now()
      } else if (msg.type === "disconnected") {
        setConnected(false)
      } else if (msg.type === "expired") {
        setConnected(false)
        setAttempt((n) => n + 1)
      }
    }
    window.addEventListener("message", onMessage)
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      window.removeEventListener("message", onMessage)
      setUrl(null)
      setConnected(false)
      setFrozen(null)
    }
  }, [enabled, paused, unavailable, failed, attempt, sessionId])

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
      const { toolCallId, label } = payload.toolCall
      if (running && needsBrowserControl(label.slice(4))) {
        setLorWaiting(toolCallId)
      } else if (!running) {
        setLorWaiting((current) => (current === toolCallId ? null : current))
      }
    }
    // A finish missed while disconnected would leave Lor waiting forever.
    const onDisconnect = () => setLorWaiting(null)
    socket.on("lor:tool", onTool)
    socket.on("disconnect", onDisconnect)
    return () => {
      if (fade) clearTimeout(fade)
      socket.off("lor:tool", onTool)
      socket.off("disconnect", onDisconnect)
    }
  }, [socket, threadRootId])

  useEffect(() => {
    if (!lorWaiting) return
    const timer = setTimeout(
      () =>
        setLorWaiting((current) => (current === lorWaiting ? null : current)),
      LOR_WAIT_MS
    )
    return () => clearTimeout(timer)
  }, [lorWaiting])

  useEffect(() => {
    if (!switching) return
    const timer = setTimeout(() => setSwitching(false), SWITCH_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [switching])

  useEffect(() => {
    if (!frozen) return
    const timer = setTimeout(() => setFrozen(null), FREEZE_MAX_MS)
    return () => clearTimeout(timer)
  }, [frozen])

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
    // Optimistic: the panel shows the new controller at once; the view
    // follows when the page reloads in its new role.
    onMutate: (take) => {
      setSwitching(true)
      const previous = controller
      setController(
        take && myId ? { userId: myId, name: auth?.user.name ?? "You" } : null
      )
      return { previous }
    },
    onSuccess: (result) => setController(result.controller),
    onError: (err, _take, context) => {
      setSwitching(false)
      if (context) setController(context.previous)
      toast.error(err.message)
    },
  })

  const switchingNow = switching || control.isPending
  useEffect(() => {
    if (!switchingNow) {
      setSlowSwitch(false)
      return
    }
    const timer = setTimeout(() => setSlowSwitch(true), SWITCH_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [switchingNow])

  // Right after taking control the view is still reconnecting as a viewer;
  // right after handing back it is still a controller until it reloads.
  const youControl =
    (myId !== null && controller?.userId === myId) ||
    (role === "control" && !switchingNow)
  const lorWants =
    lorWaiting !== null && controller !== null && kept !== lorWaiting

  // Lor asked: hand back after the controller has been idle 15 s, counting
  // from at least 5 s after the request so the notice is seen.
  useEffect(() => {
    if (!youControl || !lorWants || held) {
      setHandBackIn(null)
      return
    }
    lastInputAt.current = Math.max(
      lastInputAt.current,
      Date.now() - IDLE_HAND_BACK_MS + 5_000
    )
    let handedBack = false
    const tick = () => {
      const left = IDLE_HAND_BACK_MS - (Date.now() - lastInputAt.current)
      if (left > 0) {
        setHandBackIn(Math.ceil(left / 1000))
      } else if (!handedBack) {
        handedBack = true
        control.mutate(false)
      }
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [youControl, lorWants, held])

  return {
    frame,
    url,
    connected,
    everConnected,
    paused,
    unavailable,
    failed,
    controller,
    youControl,
    otherControls: controller !== null && !youControl,
    switching: switchingNow,
    // Only a switch that takes a while says so.
    slowSwitch,
    frozen,
    lorStep,
    expanded,
    setExpanded,
    takeControl: () => control.mutate(true),
    takeControlAsync: async () => {
      await control.mutateAsync(true)
    },
    handBack: () => control.mutate(false),
    // Lor is waiting for the browser while a person has control.
    lorWants,
    handBackIn,
    keep: () => setKept(lorWaiting),
    hold: setHeld,
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
  annotations,
}: {
  live: SessionBrowserLive
  annotations?: SessionBrowserAnnotations
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
  const corner = live.slowSwitch
    ? "Switching control…"
    : live.everConnected && !live.connected && !live.paused && !live.failed
      ? "Reconnecting…"
      : null

  // The same nodes in both sizes, so the iframe keeps its page; the display
  // follows the controller's frame size.
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
      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-lg border border-border/70 bg-muted/40 shadow-xs transition-shadow duration-200",
            youControl && "ring-2 ring-primary"
          )}
        >
          {live.url && (
            <iframe
              ref={live.frame}
              src={live.url}
              title="Session browser"
              allow="clipboard-read; clipboard-write"
              className="absolute inset-0 size-full border-0"
            />
          )}
          <AnimatePresence>
            {live.frozen && (
              <motion.img
                key="frozen"
                src={live.frozen}
                alt=""
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-none absolute inset-0 size-full"
              />
            )}
          </AnimatePresence>
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
            // While you drive, Esc goes to the page (the iframe takes it).
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
      {annotations &&
      (annotations.phase !== "off" || annotations.annotations.length > 0) ? (
        <AnnotateBar live={live} annotations={annotations} />
      ) : (
        <BrowserFooter live={live} annotations={annotations} />
      )}
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

const footerClass = (expanded: boolean) =>
  cn(
    "flex shrink-0 items-center gap-2",
    expanded &&
      "mx-auto w-full max-w-3xl rounded-lg bg-popover px-3 py-2 text-popover-foreground shadow-lg"
  )

// The status line, Annotate and the one control toggle under the frame.
function BrowserFooter({
  live,
  annotations,
}: {
  live: SessionBrowserLive
  annotations?: SessionBrowserAnnotations
}) {
  const asking = live.youControl && live.lorWants
  const status = live.slowSwitch
    ? "Switching control…"
    : asking
      ? `Lor wants the browser. It goes back in ${live.handBackIn ?? 15} s unless you keep using it.`
      : live.youControl
        ? "You have control. Lor waits until you hand it back."
        : live.controller && live.lorWants
          ? `Lor is waiting for ${live.controller.name} to hand the browser back.`
          : live.controller
            ? `${live.controller.name} has control.`
            : live.lorStep
              ? `Lor is using the browser · ${live.lorStep.text}`
              : "Watching"
  return (
    <div className={footerClass(live.expanded)}>
      {((live.lorStep && !live.controller && !live.youControl) ||
        live.lorWants) && <LiveDot />}
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          asking ? "font-medium text-foreground" : "text-muted-foreground"
        )}
        title={status}
      >
        {status}
      </p>
      {asking && (
        <Button size="sm" variant="ghost" onClick={live.keep}>
          Keep
        </Button>
      )}
      {annotations && !asking && (
        <Button
          size="sm"
          variant="outline"
          title="Pin notes to elements on the page, for Lor and everyone watching"
          disabled={live.switching || live.unavailable || !live.everConnected}
          onClick={annotations.start}
        >
          <HugeiconsIcon
            icon={CursorEdit02Icon}
            className="size-3.5"
            strokeWidth={2}
          />
          Annotate
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

// Replaces the footer while annotating: what to do on the page, the count,
// Done (or Annotate to add more), Discard and Send to Lor. The notes
// themselves are on the page.
function AnnotateBar({
  live,
  annotations,
}: {
  live: SessionBrowserLive
  annotations: SessionBrowserAnnotations
}) {
  const { phase, sending } = annotations
  const count = annotations.annotations.length
  // The idle hand-back is held while annotating, so say Lor is waiting.
  const asking = live.youControl && live.lorWants
  const status = asking
    ? count > 0
      ? "Lor wants the browser. Send or discard your notes to hand it back."
      : "Lor wants the browser. Select Done to hand it back."
    : phase === "starting"
      ? "Taking control…"
      : phase === "picking"
        ? "Click an element on the page to annotate it"
        : phase === "writing"
          ? "Type your note on the page. Enter saves it"
          : `${count} ${count === 1 ? "annotation" : "annotations"} on the page`
  return (
    <div className={footerClass(live.expanded)}>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        {phase === "starting" ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            className="size-3 animate-spin motion-reduce:animate-none"
            strokeWidth={2}
          />
        ) : (
          <HugeiconsIcon
            icon={CursorEdit02Icon}
            className="size-3"
            strokeWidth={2}
          />
        )}
      </span>
      <p
        className="min-w-0 flex-1 truncate font-medium text-foreground text-xs"
        title={status}
      >
        {status}
      </p>
      {phase === "off" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={sending || live.switching || !live.everConnected}
          onClick={annotations.start}
        >
          Annotate
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={annotations.done}>
          Done
        </Button>
      )}
      {count > 0 && (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={annotations.discard}
          >
            Discard
          </Button>
          <Button size="sm" disabled={sending} onClick={annotations.send}>
            {sending ? "Sending…" : "Send to Lor"}
          </Button>
        </>
      )}
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
