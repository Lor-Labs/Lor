import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { SendMessagePayload } from "@repo/realtime-types"
import * as SecureStore from "expo-secure-store"
import { useThemeColor } from "heroui-native/hooks"
import { useState, useSyncExternalStore } from "react"
import { Text, View } from "react-native"
import { PickerSheet } from "@/components/picker-sheet"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableScale } from "@/components/ui/pressable-scale"

// Claude Code's own permission mode for the turn a message starts, picked
// per message as in Claude Code. Remembered on the device, first Auto.
// Mirrors web's claude-code-mode-picker.tsx.

export type ClaudeCodeMode = NonNullable<SendMessagePayload["claudeCodeMode"]>

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

const MODE_DETAILS: Record<ClaudeCodeMode, string> = {
  auto: "Claude Code decides what needs your approval.",
  default: "Asks before it changes files or runs commands.",
  acceptEdits: "Changes files without asking; asks before commands.",
  plan: "Reads and plans first, then asks you to approve the plan.",
  bypassPermissions: "Never asks. Works freely in the session's sandbox.",
}

const MODE_KEY = "lor.claude-code-mode"

function savedMode(): ClaudeCodeMode {
  try {
    const value = SecureStore.getItem(MODE_KEY)
    return MODES.find((mode) => mode === value) ?? "auto"
  } catch {
    return "auto"
  }
}

// One remembered mode for every composer in the app.
let currentMode: ClaudeCodeMode | null = null
const listeners = new Set<() => void>()

// Also set by an approved plan, so the next message goes on in the mode the
// plan was approved with instead of planning again.
export function rememberClaudeCodeMode(mode: ClaudeCodeMode) {
  currentMode = mode
  try {
    SecureStore.setItem(MODE_KEY, mode)
  } catch {
    // Best-effort: the mode still applies until the app restarts.
  }
  for (const listener of listeners) listener()
}

// Module-level, so their identity is stable: a subscribe function made
// during render makes React resubscribe on every render.
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readMode(): ClaudeCodeMode {
  currentMode ??= savedMode()
  return currentMode
}

export function useClaudeCodeMode(): ClaudeCodeMode {
  return useSyncExternalStore(subscribe, readMode)
}

// A chip beside the model's; it opens the modes with what each one does.
export function ClaudeCodeModePicker() {
  const muted = useThemeColor("muted")
  const mode = useClaudeCodeMode()
  const [open, setOpen] = useState(false)
  return (
    <View>
      <PressableScale
        accessibilityHint="Chooses how much Claude Code asks before it acts"
        accessibilityLabel={`Claude Code mode: ${MODE_LABELS[mode]}`}
        accessibilityRole="button"
        className="min-h-9 flex-row items-center gap-[6px] rounded-full border border-border bg-surface px-three"
        onPress={() => setOpen(true)}
      >
        <Text
          className="text-[13px] font-semibold text-foreground"
          numberOfLines={1}
        >
          {MODE_LABELS[mode]}
        </Text>
        <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
      </PressableScale>
      <PickerSheet
        isOpen={open}
        onOpenChange={setOpen}
        onPick={(value) => {
          const next = MODES.find((item) => item === value)
          if (next && next !== mode) {
            triggerHaptic("selection")
            rememberClaudeCodeMode(next)
          }
          setOpen(false)
        }}
        options={MODES.map((item) => ({
          value: item,
          label: MODE_LABELS[item],
          detail: MODE_DETAILS[item],
        }))}
        selected={mode}
        title="Claude Code mode"
      />
    </View>
  )
}
