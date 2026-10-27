import type { AgentSession } from "@/lib/api-types"

// What runs a session's turns: Lor's own agent, Claude Code or Codex.
export type SessionHarness = AgentSession["harness"]

export const HARNESS_LABELS: Record<SessionHarness, string> = {
  pi: "Lor",
  claude_code: "Claude Code",
  codex: "Codex",
}
