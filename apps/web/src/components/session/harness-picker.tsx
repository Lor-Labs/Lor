import { isHarnessAllowedInBeta, isHarnessEnabled } from "@repo/utils/features"
import { useMemo, useState } from "react"
import { useBetaAvailability } from "@/hooks/use-beta-availability"

// Which agent runs a code session, fixed at its start
// (reference/planned/code-sessions-runbook.md chunks 7 and 8f): Lor's own,
// Claude Code on each sender's own Claude subscription, or Codex on their own
// ChatGPT plan. Picked with its model in the New session view's ModelPicker.
// Hosted beta hides any harness outside `HOSTED_BETA_HARNESSES`; the server
// enforces the same set in `assertHostedHarness`.

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
  codex:
    "Runs on your own ChatGPT plan. Each person's messages use their own plan.",
}

const HARNESS_KEY = "lor:new-session-harness"

// Hosted beta offers only its harnesses, whatever the feature flags say.
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
  // A saved pick (or a `?harness=` link) the beta doesn't offer falls back to
  // Lor once the beta is known to be on; the state itself is left alone.
  return [allowed(harness) ? harness : "pi", change]
}
