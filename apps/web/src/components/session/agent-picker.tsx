import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { CustomMenuItem } from "@repo/ui/components/custom-menu-item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { Fragment } from "react"
import {
  CLAUDE_MODEL_LABELS,
  CLAUDE_MODEL_TOOLTIPS,
  CLAUDE_MODELS,
  type ClaudeModel,
} from "@/components/session/claude-model-picker"
import {
  CODEX_MODEL_LABELS,
  CODEX_MODEL_TOOLTIPS,
  CODEX_MODELS,
  type CodexModel,
} from "@/components/session/codex-model-picker"
import {
  HARNESS_LABELS,
  HARNESS_TOOLTIPS,
  HARNESSES,
  type SessionHarness,
} from "@/components/session/harness-picker"

// A new code session's agent and model in one picker, like a model picker in
// Codex: "Claude Code · Opus". Lor's own agent has no model choice.
export function AgentPicker({
  harness,
  onHarness,
  claudeModel,
  onClaudeModel,
  codexModel,
  onCodexModel,
}: {
  harness: SessionHarness
  onHarness: (harness: SessionHarness) => void
  claudeModel: ClaudeModel
  onClaudeModel: (model: ClaudeModel) => void
  codexModel: CodexModel
  onCodexModel: (model: CodexModel) => void
}) {
  const model =
    harness === "claude_code"
      ? CLAUDE_MODEL_LABELS[claudeModel]
      : harness === "codex"
        ? CODEX_MODEL_LABELS[codexModel]
        : null
  const tick = <HugeiconsIcon icon={Tick02Icon} className="ml-auto size-4" />

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title="Agent and model"
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent"
      >
        <span className="text-foreground/80">{HARNESS_LABELS[harness]}</span>
        {model}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {HARNESSES.map((option, index) => (
          <Fragment key={option}>
            {index > 0 && <DropdownMenuSeparator />}
            {option === "pi" ? (
              <CustomMenuItem
                tooltip={HARNESS_TOOLTIPS.pi}
                onClick={() => onHarness("pi")}
              >
                {HARNESS_LABELS.pi}
                {harness === "pi" && tick}
              </CustomMenuItem>
            ) : (
              <DropdownMenuGroup>
                <DropdownMenuLabel title={HARNESS_TOOLTIPS[option]}>
                  {HARNESS_LABELS[option]}
                </DropdownMenuLabel>
                {option === "claude_code"
                  ? CLAUDE_MODELS.map((value) => (
                      <CustomMenuItem
                        key={value}
                        tooltip={CLAUDE_MODEL_TOOLTIPS[value]}
                        onClick={() => {
                          onHarness("claude_code")
                          onClaudeModel(value)
                        }}
                      >
                        {CLAUDE_MODEL_LABELS[value]}
                        {harness === "claude_code" &&
                          claudeModel === value &&
                          tick}
                      </CustomMenuItem>
                    ))
                  : CODEX_MODELS.map((value) => (
                      <CustomMenuItem
                        key={value}
                        tooltip={CODEX_MODEL_TOOLTIPS[value]}
                        onClick={() => {
                          onHarness("codex")
                          onCodexModel(value)
                        }}
                      >
                        {CODEX_MODEL_LABELS[value]}
                        {harness === "codex" && codexModel === value && tick}
                      </CustomMenuItem>
                    ))}
              </DropdownMenuGroup>
            )}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
