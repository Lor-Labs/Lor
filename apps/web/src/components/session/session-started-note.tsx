import type { RealtimeAgentSession } from "@repo/realtime-types"
import { Spinner } from "@repo/ui/components/spinner"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { Link } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

const NOTE_MS = 6000

// Cmd+Enter starts a session and keeps the sender where they are, so several
// can start in a row (Enter opens it instead). The note confirms each start.
export function useSessionStartedNote() {
  const [started, setStarted] = useState<RealtimeAgentSession | null>(null)
  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => setStarted(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [started])
  return { started, onSessionStarted: setStarted }
}

export function SessionStartedNote({
  session,
  workspaceSlug,
}: {
  session: RealtimeAgentSession | null
  workspaceSlug: string
}) {
  return (
    <AnimatePresence>
      {session && (
        <motion.div
          key={session.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
          className="absolute bottom-full left-4 z-10 mb-1 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
        >
          <Spinner className="size-3 shrink-0 text-agent" />
          <span className="truncate">
            Started{" "}
            <span className="font-medium text-foreground">{session.title}</span>
          </span>
          <Link
            to="/$workspaceSlug/session/$sessionId"
            params={{ workspaceSlug, sessionId: session.id }}
            className="shrink-0 font-medium text-agent hover:underline"
          >
            Open
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
