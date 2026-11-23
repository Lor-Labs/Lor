import { cn } from "@repo/ui/lib/utils"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import type { SessionHarness } from "@/components/session/harness-picker"

export type SessionAgent = {
  harness: Exclude<SessionHarness, "pi">
  name: string
}

const NAMES: Record<SessionAgent["harness"], string> = {
  claude_code: "Claude",
  codex: "Codex",
}

const SessionAgentContext = createContext<SessionAgent | null>(null)

// In a code session the one answering is Claude Code or Codex, not Lor: its
// replies, the composer's "To" pill and the turn rail wear that coding
// agent's mark and name, so the channel agent that briefs a session and the
// coding agent that does the work read as two. Sessions on Lor's own agent
// (pi, older ones) have no provider value and stay Lor.
export function SessionAgentProvider({
  harness,
  children,
}: {
  harness: SessionHarness
  children: ReactNode
}) {
  const agent = useMemo(
    () => (harness === "pi" ? null : { harness, name: NAMES[harness] }),
    [harness]
  )
  return <SessionAgentContext value={agent}>{children}</SessionAgentContext>
}

export function useSessionAgent() {
  return useContext(SessionAgentContext)
}

// The coding agent's mark as a round avatar, where Lor's would be.
export function SessionAgentAvatar({
  agent,
  className,
  title,
}: {
  agent: SessionAgent
  className?: string
  title?: string
}) {
  return (
    <span
      role="img"
      aria-label={agent.name}
      title={title}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground",
        className
      )}
    >
      <HarnessLogo harness={agent.harness} className="size-[58%]" />
    </span>
  )
}
