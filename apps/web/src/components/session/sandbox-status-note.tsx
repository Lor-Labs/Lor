import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Spinner } from "@repo/ui/components/spinner"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { sessionChangesQueryOptions } from "@/hooks/use-session-changes"

// Above the composer while a code session's sandbox is replaced (a new size)
// or rebuilt from its last checkpoint, then "ready" for a moment: people see
// when it is done. A message sent meanwhile is not lost; Lor's turn waits
// for the sandbox.

const POLL_MS = 4_000
const READY_SHOWN_MS = 4_000

export function SandboxStatusNote({ sessionId }: { sessionId: string }) {
  // Reads what the Changes panel or the setup dialog put in the cache, and
  // fetches only while a restore is under way: opening a session never
  // starts one. Polls too, in case the restore's broadcast is missed.
  const { data, refetch } = useQuery({
    ...sessionChangesQueryOptions(sessionId),
    enabled: (query) => query.state.data?.state === "restoring",
    refetchInterval: (query) =>
      query.state.data?.state === "restoring" ? POLL_MS : false,
  })
  // A replacement or restore someone else started: invalidation skips this
  // query while it is disabled (panel closed, cache ready or empty), so the
  // server's broadcast fetches it once here.
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return
    const onChanged = (payload: {
      sessionId: string
      filesChanged?: boolean
    }) => {
      if (payload.sessionId === sessionId && payload.filesChanged) {
        void refetch({ cancelRefetch: false })
      }
    }
    socket.on("session:changes:updated", onChanged)
    return () => {
      socket.off("session:changes:updated", onChanged)
    }
  }, [socket, sessionId, refetch])
  const state = data?.state
  const [phase, setPhase] = useState<"idle" | "restoring" | "ready">("idle")
  useEffect(() => {
    if (state === "restoring") {
      setPhase("restoring")
      return
    }
    setPhase((current) =>
      current === "restoring" && state === "ready" ? "ready" : "idle"
    )
  }, [state])
  useEffect(() => {
    if (phase !== "ready") return
    const timer = setTimeout(() => setPhase("idle"), READY_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === "idle") return null
  return (
    <div
      className="flex items-center gap-2 pb-2 text-muted-foreground text-xs"
      aria-live="polite"
    >
      {phase === "restoring" ? (
        <>
          <Spinner className="size-3" />
          <span>
            Setting up the sandbox. Messages you send now start when it is
            ready.
          </span>
        </>
      ) : (
        <>
          <HugeiconsIcon icon={Tick02Icon} className="size-3" strokeWidth={2} />
          <span>The sandbox is ready</span>
        </>
      )}
    </div>
  )
}
