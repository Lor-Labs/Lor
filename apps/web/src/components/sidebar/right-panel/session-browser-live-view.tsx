import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type RFB from "@novnc/novnc"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// The session browser's live view (reference/planned/sandbox-browser-runbook.md
// §4): noVNC on the sandbox's gateway. Each connection needs a fresh one-time
// token, so every reconnect asks the API again. The gateway closes a viewer
// whose role changed (control taken or handed back), and the view reconnects
// in its new role. A hidden page disconnects, since live traffic keeps the
// sandbox awake and billed.

export type BrowserController = { userId: string; name: string } | null

const RETRY_MS = [300, 1000, 2000, 5000, 10_000]
const HIDDEN_PAUSE_MS = 2 * 60_000

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return body?.message ?? fallback
}

export function useSessionBrowserLive(sessionId: string, enabled: boolean) {
  const socket = useSocket()
  const { data: auth } = authClient.useSession()
  const myId = auth?.user.id ?? null
  const [screen, setScreen] = useState<HTMLDivElement | null>(null)
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [role, setRole] = useState<"control" | "watch">("watch")
  const [controller, setController] = useState<BrowserController>(null)
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)

  useEffect(() => {
    if (!enabled || !screen || paused || unavailable || failed) return
    let cancelled = false
    let rfb: RFB | null = null
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
      rfb.addEventListener("connect", () => {
        failures.current = 0
        setConnected(true)
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
    onSuccess: (result) => setController(result.controller),
    onError: (err) => toast.error(err.message),
  })

  return {
    setScreen,
    connected,
    paused,
    unavailable,
    failed,
    controller,
    // Right after taking control the view is still reconnecting as a viewer.
    youControl:
      role === "control" || (myId !== null && controller?.userId === myId),
    controlPending: control.isPending,
    takeControl: () => control.mutate(true),
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

export function SessionBrowserLiveView({ live }: { live: SessionBrowserLive }) {
  const overlay = live.paused ? (
    <LiveOverlay text="Paused while this tab was hidden, so the sandbox can sleep. The browser and the app are still running.">
      <Button size="sm" variant="outline" onClick={live.resume}>
        Resume
      </Button>
    </LiveOverlay>
  ) : live.failed ? (
    <LiveOverlay text={live.failed}>
      <Button size="sm" variant="outline" onClick={live.resume}>
        Reconnect
      </Button>
    </LiveOverlay>
  ) : !live.connected ? (
    <LiveOverlay
      text="Connecting to the browser…"
      icon={
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-4 animate-spin motion-reduce:animate-none"
          strokeWidth={2}
        />
      }
    />
  ) : null

  return (
    <div className="relative min-h-0 flex-1 bg-muted/40">
      <div ref={live.setScreen} className="absolute inset-0" />
      {overlay}
    </div>
  )
}

function LiveOverlay({
  text,
  icon,
  children,
}: {
  text: string
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-8 text-center">
      <p className="flex max-w-xs items-center gap-2 text-muted-foreground text-xs leading-relaxed">
        {icon}
        {text}
      </p>
      {children}
    </div>
  )
}

// Who drives the browser, and the button to take or hand back control.
export function SessionBrowserControl({ live }: { live: SessionBrowserLive }) {
  const label = live.youControl
    ? "You have control"
    : live.controller
      ? `${live.controller.name} has control`
      : "Watching"
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <span className="truncate text-muted-foreground text-xs">{label}</span>
      <Button
        size="xs"
        variant={live.youControl ? "outline" : "default"}
        disabled={live.controlPending || live.unavailable}
        onClick={live.youControl ? live.handBack : live.takeControl}
      >
        {live.youControl ? "Hand back" : "Take control"}
      </Button>
    </div>
  )
}
