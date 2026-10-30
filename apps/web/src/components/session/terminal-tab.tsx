import "@xterm/xterm/css/xterm.css"
import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// The code session's Terminal tab (reference/dev-environment-runbook.md §4):
// xterm.js on ttyd's WebSocket. Each person gets their own tmux session in
// the sandbox, so closing the socket (tab switch, idle, network) keeps the
// shell and whatever runs in it; reconnecting picks it back up.

const HIDDEN_DISCONNECT_MS = 2 * 60_000
const LOCALHOST_URL =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d+))?(\/[^\s]*)?/

// ttyd's protocol: one leading byte names the message.
const OUTPUT = 0x30 // "0"
const encoder = new TextEncoder()

type Phase =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; message: string }

async function terminalUrl(sessionId: string): Promise<string> {
  const res = await apiClient.v1.sessions[":sessionId"].terminal.$post({
    param: { sessionId },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(body?.message ?? "Couldn't open the terminal")
  }
  return (await res.json()).url
}

function themeFrom(element: HTMLElement) {
  const style = getComputedStyle(element)
  return {
    background: style.backgroundColor,
    foreground: style.color,
    cursor: style.color,
  }
}

export function TerminalTab({
  sessionId,
  onOpenPort,
}: {
  sessionId: string
  // A localhost link printed in the terminal (a dev server's URL).
  onOpenPort: (port: number, path: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" })
  const [attempt, setAttempt] = useState(0)
  // A ref, so a new callback each render never reconnects the terminal.
  const openPortRef = useRef(onOpenPort)
  useEffect(() => {
    openPortRef.current = onOpenPort
  }, [onOpenPort])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let socket: WebSocket | null = null
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null
    setPhase({ kind: "connecting" })

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        getComputedStyle(host).getPropertyValue("--font-mono") || "monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: themeFrom(host),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        const local = uri.match(LOCALHOST_URL)
        if (local) openPortRef.current(Number(local[1] ?? 80), local[2] ?? "/")
        else openExternal(uri)
      })
    )
    term.open(host)
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // No WebGL (some desktop GPUs): xterm's DOM renderer is the fallback.
    }
    fit.fit()

    const send = (text: string) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(encoder.encode(text))
    }
    const sendSize = () =>
      send(`1${JSON.stringify({ columns: term.cols, rows: term.rows })}`)
    const input = term.onData((data) => send(`0${data}`))
    const resize = new ResizeObserver(() => {
      fit.fit()
      sendSize()
    })
    resize.observe(host)

    const close = (message: string) => {
      socket?.close()
      socket = null
      if (!disposed) setPhase({ kind: "closed", message })
    }
    // Hidden a while: drop the socket so the sandbox can sleep.
    const onVisibility = () => {
      if (hiddenTimer) clearTimeout(hiddenTimer)
      hiddenTimer = document.hidden
        ? setTimeout(
            () => close("Disconnected while this page was hidden."),
            HIDDEN_DISCONNECT_MS
          )
        : null
    }
    document.addEventListener("visibilitychange", onVisibility)

    terminalUrl(sessionId)
      .then((url) => {
        if (disposed) return
        socket = new WebSocket(url, ["tty"])
        socket.binaryType = "arraybuffer"
        socket.onopen = () => {
          send(
            JSON.stringify({
              AuthToken: "",
              columns: term.cols,
              rows: term.rows,
            })
          )
          setPhase({ kind: "open" })
          term.focus()
        }
        socket.onmessage = (event) => {
          const bytes = new Uint8Array(event.data as ArrayBuffer)
          if (bytes[0] === OUTPUT) term.write(bytes.subarray(1))
        }
        socket.onclose = () => close("The terminal disconnected.")
      })
      .catch((err: Error) => close(err.message))

    return () => {
      disposed = true
      if (hiddenTimer) clearTimeout(hiddenTimer)
      document.removeEventListener("visibilitychange", onVisibility)
      resize.disconnect()
      input.dispose()
      socket?.close()
      term.dispose()
    }
  }, [sessionId, attempt])

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div
        ref={hostRef}
        className="min-h-0 flex-1 bg-background p-2 text-foreground"
      />
      {phase.kind !== "open" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center text-muted-foreground text-sm">
          {phase.kind === "connecting" ? (
            <>
              <Spinner className="size-4" />
              Starting the terminal…
            </>
          ) : (
            <>
              {phase.message} Your shell keeps running.
              <Button
                size="xs"
                variant="outline"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Reconnect
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
