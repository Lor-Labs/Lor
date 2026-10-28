import { isHarnessEnabled } from "@repo/utils/features"
import { useState } from "react"

// Which agent runs a code session, fixed at its start
// (reference/planned/code-sessions-runbook.md chunks 7 and 8): Lor's own,
// Claude Code on the starter's own Claude subscription, or Codex on Lor
// credits. Picked with its model in the New session view's ModelPicker.

export type SessionHarness = "pi" | "claude_code" | "codex"

export const HARNESSES = (["pi", "claude_code", "codex"] as const).filter(
  isHarnessEnabled
)

export const HARNESS_LABELS: Record<SessionHarness, string> = {
  pi: "Lor",
  claude_code: "Claude Code",
  codex: "Codex",
}

export const HARNESS_TOOLTIPS: Record<SessionHarness, string> = {
  pi: "Lor's own agent, on Lor credits.",
  claude_code:
    "Runs on your own Claude Pro or Max plan. Each person's messages use their own plan.",
  codex: "OpenAI's coding agent, on Lor credits.",
}

const HARNESS_KEY = "lor:new-session-harness"

// `start` opens on that harness (Continue with Lor) without changing the
// saved choice; picking still saves.
export function useSessionHarness(
  start?: SessionHarness
): [SessionHarness, (harness: SessionHarness) => void] {
  const [harness, setHarness] = useState<SessionHarness>(() => {
    if (start && isHarnessEnabled(start)) return start
    try {
      const saved = localStorage.getItem(HARNESS_KEY)
      return HARNESSES.find((harness) => harness === saved) ?? "pi"
    } catch {
      return "pi"
    }
  })
  const change = (next: SessionHarness) => {
    if (!isHarnessEnabled(next)) return
    setHarness(next)
    try {
      localStorage.setItem(HARNESS_KEY, next)
    } catch {}
  }
  return [harness, change]
}
