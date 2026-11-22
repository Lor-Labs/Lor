import { createContext, type ReactNode, useContext, useMemo } from "react"
import type { ChannelAgent } from "@/hooks/use-channel-agent"
import type { SessionHarness } from "@/lib/harness"

// In a code session the one answering is Claude Code or Codex, not Lor: its
// replies and the composer's "To" pill wear that coding agent's mark and
// name, and the channel agent that briefed the session shows as itself.
// Mirrors web's session-agent.tsx. Sessions on Lor's own agent have no
// coder and stay Lor.
export type SessionCoder = {
  harness: Exclude<SessionHarness, "pi">
  name: string
}

const NAMES: Record<SessionCoder["harness"], string> = {
  claude_code: "Claude",
  codex: "Codex",
}

type SessionAgents = {
  coder: SessionCoder | null
  // The agent of the channel the session is in.
  channelAgent: ChannelAgent | null
}

const NONE: SessionAgents = { coder: null, channelAgent: null }
const SessionAgentContext = createContext<SessionAgents>(NONE)

export function SessionAgentProvider({
  harness,
  channelAgent,
  children,
}: {
  // Null outside a session.
  harness: SessionHarness | null
  channelAgent: ChannelAgent | null
  children: ReactNode
}) {
  const value = useMemo(
    () =>
      harness === null
        ? NONE
        : {
            coder: harness === "pi" ? null : { harness, name: NAMES[harness] },
            channelAgent,
          },
    [harness, channelAgent]
  )
  return <SessionAgentContext value={value}>{children}</SessionAgentContext>
}

export function useSessionCoder() {
  return useContext(SessionAgentContext).coder
}

export function useSessionChannelAgent() {
  return useContext(SessionAgentContext).channelAgent
}
