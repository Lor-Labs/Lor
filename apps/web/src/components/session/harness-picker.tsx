import { isHarnessAllowedInBeta, isHarnessEnabled } from "@repo/utils/features"
import { useMemo, useState } from "react"
import { useBetaAvailability } from "@/hooks/use-beta-availability"

// Which agent runs a code session, fixed at its start
// (reference/planned/code-sessions-runbook.md chunks 7 and 8): Lor's own,
// Claude Code on the starter's own Claude subscription, or Codex on Lor
// credits. Picked with its model in the New session view's ModelPicker.
// Hosted beta allows Lor and Claude Code (the person's own subscription) and
// hides the rest; the server enforces the same set in `assertHostedHarness`.

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
  pi: "Lor's own agent, using workspace credits or its API key.",
  claude_code:
    "Runs on your own Claude Pro or Max plan. Each person's messages use their own plan.",
  codex: "OpenAI's coding agent, on Lor credits.",
}

const HARNESS_KEY = "lor:new-session-harness"

// Hosted beta offers only its harnesses, whatever the feature flags say
// (Codex is enabled by its flag alone, but the beta doesn't run credit-funded
// agents).
function availableHarnesses(betaEnabled: boolean): readonly SessionHarness[] {
  return betaEnabled ? HARNESSES.filter(isHarnessAllowedInBeta) : HARNESSES
}

export function useAvailableHarnesses(): readonly SessionHarness[] {
  const { data: beta } = useBetaAvailability()
  const betaEnabled = beta?.enabled === true
  return useMemo(() => availableHarnesses(betaEnabled), [betaEnabled])
}

// `start` opens on that harness (Continue with Lor) without changing the
// saved choice; picking still saves.
export function useSessionHarness(
  start?: SessionHarness
): [SessionHarness, (harness: SessionHarness) => void] {
  const { data: beta } = useBetaAvailability()
  const betaEnabled = beta?.enabled === true
  const allowed = (harness: SessionHarness) =>
    isHarnessEnabled(harness) &&
    (!betaEnabled || isHarnessAllowedInBeta(harness))
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
    if (!allowed(next)) return
    setHarness(next)
    try {
      localStorage.setItem(HARNESS_KEY, next)
    } catch {}
  }
  // A saved Codex pick (or a `?harness=` link) falls back to Lor once the
  // beta is known to be on; the state itself is left alone.
  return [allowed(harness) ? harness : "pi", change]
}
