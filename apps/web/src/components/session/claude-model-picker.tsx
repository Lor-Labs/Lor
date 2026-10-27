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

// The model for the turn a message starts in a Claude Code session, picked
// per message as Claude Code's own aliases, on the sender's subscription.
// Remembered per person, first Opus.

export type ClaudeModel = NonNullable<SendMessagePayload["claudeModel"]>

const MODELS: ClaudeModel[] = ["opus", "sonnet", "haiku", "fable"]

const MODEL_LABELS: Record<ClaudeModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
}

const MODEL_TOOLTIPS: Record<ClaudeModel, string> = {
  opus: "Claude Code's default, for complex work.",
  sonnet: "For everyday coding. Uses less of your plan's limits.",
  haiku: "Fast and light, for simple changes.",
  fable:
    "Anthropic's most capable, for the hardest work. On some plans it uses extra usage credits.",
}

const MODEL_KEY = "lor:claude-model"

function savedModel(): ClaudeModel {
  try {
    const value = localStorage.getItem(MODEL_KEY)
    return MODELS.find((model) => model === value) ?? "opus"
  } catch {
    return "opus"
  }
}

// One remembered model for every composer on the page.
let currentModel: ClaudeModel | null = null
const listeners = new Set<() => void>()

function rememberClaudeModel(model: ClaudeModel) {
  currentModel = model
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {}
  for (const listener of listeners) listener()
}

export function useClaudeModel(): {
  model: ClaudeModel
  setModel: (model: ClaudeModel) => void
} {
  const model = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => {
      currentModel ??= savedModel()
      return currentModel
    }
  )
  return { model, setModel: rememberClaudeModel }
}

export function ClaudeModelPicker({
  value,
  onChange,
}: {
  value: ClaudeModel
  onChange: (model: ClaudeModel) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title="Claude model"
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent"
      >
        {MODEL_LABELS[value]}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {MODELS.map((model) => (
          <CustomMenuItem
            key={model}
            tooltip={MODEL_TOOLTIPS[model]}
            onClick={() => onChange(model)}
          >
            {MODEL_LABELS[model]}
            {value === model && (
              <HugeiconsIcon icon={Tick02Icon} className="ml-auto size-4" />
            )}
          </CustomMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
