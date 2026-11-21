import { isHarnessAllowedInBeta, isHarnessEnabled } from "@repo/utils/features"
import { useMemo, useState } from "react"
import { useBetaAvailability } from "@/hooks/use-beta-availability"

// Which agent runs a code session, fixed at its start
// (reference/planned/code-sessions-runbook.md chunks 7 and 8f): Claude Code
// on each sender's own Claude subscription, or Codex on their own ChatGPT
// plan. Lor's own agent ("pi") no longer starts sessions
// (reference/always-on-agents.md, decision 34); older sessions keep it. Picked with its model in the New session view's ModelPicker.
// Hosted beta hides any harness outside `HOSTED_BETA_HARNESSES`; the server
// enforces the same set in `assertHostedHarness`.

export type SessionHarness = "pi" | "claude_code" | "codex"

export const HARNESSES = (["claude_code", "codex"] as const).filter(
  isHarnessEnabled
)
const DEFAULT_HARNESS: SessionHarness = HARNESSES[0] ?? "claude_code"

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

// `start` opens on that harness without changing the saved choice; picking
// still saves.
export function useSessionHarness(
  start?: SessionHarness
): [SessionHarness, (harness: SessionHarness) => void] {
  const { data: beta } = useBetaAvailability()
  const betaEnabled = beta?.enabled === true
  const allowed = (harness: SessionHarness) =>
    HARNESSES.some((candidate) => candidate === harness) &&
    isHarnessEnabled(harness) &&
    (!betaEnabled || isHarnessAllowedInBeta(harness))
  const [harness, setHarness] = useState<SessionHarness>(() => {
    if (start && HARNESSES.some((harness) => harness === start)) return start
    try {
      const saved = localStorage.getItem(HARNESS_KEY)
      return HARNESSES.find((harness) => harness === saved) ?? DEFAULT_HARNESS
    } catch {
      return DEFAULT_HARNESS
    }
  })
  const change = (next: SessionHarness) => {
    if (!allowed(next)) return
    setHarness(next)
    try {
      localStorage.setItem(HARNESS_KEY, next)
    } catch {}
  }
  // A saved pick (or a `?harness=` link) that isn't offered falls back to the
  // first one that is; the state itself is left alone.
  const fallback =
    HARNESSES.find((candidate) => allowed(candidate)) ?? DEFAULT_HARNESS
  return [allowed(harness) ? harness : fallback, change]
}
