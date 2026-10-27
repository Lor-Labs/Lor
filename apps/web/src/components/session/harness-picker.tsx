import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { CustomMenuItem } from "@repo/ui/components/custom-menu-item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { useState } from "react"

// Which agent runs a code session, fixed at its start
// (reference/planned/code-sessions-runbook.md chunks 7 and 8): Lor's own,
// Claude Code on the starter's own Claude subscription, or Codex on Lor
// credits.

export type SessionHarness = "pi" | "claude_code" | "codex"

const HARNESSES: SessionHarness[] = ["pi", "claude_code", "codex"]

export const HARNESS_LABELS: Record<SessionHarness, string> = {
  pi: "Lor",
  claude_code: "Claude Code",
  codex: "Codex",
}

const HARNESS_TOOLTIPS: Record<SessionHarness, string> = {
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
    if (start) return start
    try {
      const saved = localStorage.getItem(HARNESS_KEY)
      return HARNESSES.find((harness) => harness === saved) ?? "pi"
    } catch {
      return "pi"
    }
  })
  const change = (next: SessionHarness) => {
    setHarness(next)
    try {
      localStorage.setItem(HARNESS_KEY, next)
    } catch {}
  }
  return [harness, change]
}

export function HarnessPicker({
  value,
  onChange,
}: {
  value: SessionHarness
  onChange: (harness: SessionHarness) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 font-medium text-agent transition-colors hover:bg-agent/10 data-popup-open:bg-agent/10">
        <span className="text-muted-foreground">with</span>
        {HARNESS_LABELS[value]}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {HARNESSES.map((harness) => (
          <CustomMenuItem
            key={harness}
            tooltip={HARNESS_TOOLTIPS[harness]}
            onClick={() => onChange(harness)}
          >
            {HARNESS_LABELS[harness]}
            {value === harness && (
              <HugeiconsIcon icon={Tick02Icon} className="ml-auto size-4" />
            )}
          </CustomMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
