import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { CustomMenuItem } from "@repo/ui/components/custom-menu-item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { useSyncExternalStore } from "react"

// The model for the turn a message starts in a Codex session, picked per
// message (code-sessions-runbook.md chunk 8). Remembered per person, first
// GPT-6.1 Sol.

// Until the model catalog lands (Codex's own list), its three models.
export type CodexModel = "gpt-6.1-sol" | "gpt-6-astra" | "gpt-6-luna"

const MODELS: CodexModel[] = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]

const MODEL_LABELS: Record<CodexModel, string> = {
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-6-luna": "GPT-6 Luna",
}

const MODEL_TOOLTIPS: Record<CodexModel, string> = {
  "gpt-6.1-sol": "OpenAI's pick for everyday coding.",
  "gpt-6-astra": "The most capable, for the hardest work. Uses more credits.",
  "gpt-6-luna": "Fast and light, for simple changes. Uses fewer credits.",
}

const MODEL_KEY = "lor:codex-model"

function savedModel(): CodexModel {
  try {
    const value = localStorage.getItem(MODEL_KEY)
    return MODELS.find((model) => model === value) ?? "gpt-6.1-sol"
  } catch {
    return "gpt-6.1-sol"
  }
}

// One remembered model for every composer on the page.
let currentModel: CodexModel | null = null
const listeners = new Set<() => void>()

function rememberCodexModel(model: CodexModel) {
  currentModel = model
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {}
  for (const listener of listeners) listener()
}

export function useCodexModel(): {
  model: CodexModel
  setModel: (model: CodexModel) => void
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
  return { model, setModel: rememberCodexModel }
}

export {
  MODELS as CODEX_MODELS,
  MODEL_LABELS as CODEX_MODEL_LABELS,
  MODEL_TOOLTIPS as CODEX_MODEL_TOOLTIPS,
}

export function CodexModelPicker({
  value,
  onChange,
}: {
  value: CodexModel
  onChange: (model: CodexModel) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title="Codex model"
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
