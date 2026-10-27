import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { SendMessagePayload } from "@repo/realtime-types"
import { CustomMenuItem } from "@repo/ui/components/custom-menu-item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { useSyncExternalStore } from "react"

// Claude Code's own permission mode for the turn a message starts, picked
// per message like Shift+Tab in Claude Code (code-sessions-runbook.md chunk
// 7d-4b). Remembered per person, first Auto.

export type ClaudeCodeMode = NonNullable<SendMessagePayload["claudeCodeMode"]>

// Menu order is also the Shift+Tab cycle.
const MODES: ClaudeCodeMode[] = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
]

const MODE_LABELS: Record<ClaudeCodeMode, string> = {
  auto: "Auto",
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Bypass permissions",
}

const MODE_TOOLTIPS: Record<ClaudeCodeMode, string> = {
  auto: "Claude Code decides what needs your approval.",
  default: "Asks before it changes files or runs commands.",
  acceptEdits: "Changes files without asking; asks before commands.",
  plan: "Reads and plans first, then asks you to approve the plan.",
  bypassPermissions: "Never asks. Works freely in the session's sandbox.",
}

const MODE_KEY = "lor:claude-code-mode"

function savedMode(): ClaudeCodeMode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    return MODES.find((mode) => mode === value) ?? "auto"
  } catch {
    return "auto"
  }
}

// One remembered mode for every composer on the page.
let currentMode: ClaudeCodeMode | null = null
const listeners = new Set<() => void>()

// Also set by an approved plan, so the next message goes on in the mode the
// plan was approved with instead of planning again.
export function rememberClaudeCodeMode(mode: ClaudeCodeMode) {
  currentMode = mode
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {}
  for (const listener of listeners) listener()
}

export function useClaudeCodeMode(): {
  mode: ClaudeCodeMode
  setMode: (mode: ClaudeCodeMode) => void
  cycle: () => void
} {
  const mode = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => {
      currentMode ??= savedMode()
      return currentMode
    }
  )
  const cycle = () =>
    rememberClaudeCodeMode(
      MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? "auto"
    )
  return { mode, setMode: rememberClaudeCodeMode, cycle }
}

export function ClaudeCodeModePicker({
  value,
  onChange,
}: {
  value: ClaudeCodeMode
  onChange: (mode: ClaudeCodeMode) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title="Claude Code mode (Shift+Tab)"
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent"
      >
        {MODE_LABELS[value]}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {MODES.map((mode) => (
          <CustomMenuItem
            key={mode}
            tooltip={MODE_TOOLTIPS[mode]}
            onClick={() => onChange(mode)}
          >
            {MODE_LABELS[mode]}
            {value === mode && (
              <HugeiconsIcon icon={Tick02Icon} className="ml-auto size-4" />
            )}
          </CustomMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
