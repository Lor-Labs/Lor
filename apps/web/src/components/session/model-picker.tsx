import {
  ArrowDown01Icon,
  BrainIcon,
  FlashIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Combobox, ComboboxPrimitive } from "@repo/ui/components/combobox"
import { HoverSideTooltip } from "@repo/ui/components/hover-side-tooltip"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { cn } from "@repo/ui/lib/utils"
import { useQueries } from "@tanstack/react-query"
import { type ReactNode, useRef, useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import {
  HARNESS_LABELS,
  HARNESS_TOOLTIPS,
  type SessionHarness,
} from "@/components/session/harness-picker"
import {
  type AgentModelOption,
  agentModelsQueryOptions,
  type ModelChoice,
  rememberEffort,
  rememberFast,
  rememberModel,
} from "@/hooks/use-agent-models"

// The model, thinking effort and fast mode for the turn a message starts,
// in every session composer. The lists come from the harness's own catalog
// (use-agent-models.ts), so nothing here names a model.

const TRIGGER_CLASS =
  "inline-flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent"

type ModelItem = {
  harness: SessionHarness
  id: string
  name: string
  // Beside the row on hover: the exact model behind a name like "Opus".
  detail: ReactNode
  search: string
}

// The combobox holds string keys, unique across harnesses, so its value
// stays the same between renders.
const itemKey = (harness: SessionHarness, id: string) => `${harness}:${id}`

function modelDetail(model: AgentModelOption): ReactNode {
  const exact =
    model.resolvedModel && model.resolvedModel !== model.id
      ? model.resolvedModel
      : null
  if (!model.description && !exact) return null
  return (
    <div className="flex flex-col gap-0.5">
      {model.description && <span>{model.description}</span>}
      {exact && <span className="text-muted-foreground text-xs">{exact}</span>}
    </div>
  )
}

// Laid out like T3 Code's picker. With more than one agent (a new code
// session) their logos run down the left and the list shows one agent's
// models; a search covers them all, Lor's long list last. Picking a model
// also picks its agent.
export function ModelPicker({
  choice,
  harnesses = [choice.harness],
  onHarness,
}: {
  choice: ModelChoice
  harnesses?: readonly SessionHarness[]
  onHarness?: (harness: SessionHarness) => void
}) {
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState(choice.harness)
  const inputRef = useRef<HTMLInputElement>(null)
  const catalogs = useQueries({
    queries: harnesses.map((harness) => agentModelsQueryOptions(harness)),
  })
  const byKey = new Map<string, ModelItem>()
  const keysOf = new Map<SessionHarness, string[]>()
  harnesses.forEach((harness, index) => {
    const models = catalogs[index]?.data?.models ?? []
    keysOf.set(
      harness,
      models.map((model) => {
        const key = itemKey(harness, model.id)
        byKey.set(key, {
          harness,
          id: model.id,
          name: model.name,
          detail: modelDetail(model),
          search: [
            model.name,
            model.id,
            model.description,
            model.provider,
            HARNESS_LABELS[harness],
          ]
            .join(" ")
            .toLowerCase(),
        })
        return key
      })
    )
  })
  const sidebar = harnesses.length > 1
  const searching = query.trim() !== ""
  const items =
    sidebar && !searching
      ? (keysOf.get(shown) ?? [])
      : [...harnesses]
          .sort((a, b) => Number(a === "pi") - Number(b === "pi"))
          .flatMap((harness) => keysOf.get(harness) ?? [])
  const selected = choice.option
    ? itemKey(choice.harness, choice.option.id)
    : null
  const showAgent = (harness: SessionHarness) => {
    setQuery("")
    setShown(harness)
    inputRef.current?.focus()
  }

  return (
    <Combobox<string>
      items={items}
      value={selected}
      onValueChange={(key) => {
        const item = key ? byKey.get(key) : undefined
        if (!item) return
        if (item.harness !== choice.harness) onHarness?.(item.harness)
        rememberModel(item.harness, item.id)
      }}
      itemToStringLabel={(key) => byKey.get(key)?.name ?? key}
      filter={(key: string, text) =>
        byKey.get(key)?.search.includes(text.trim().toLowerCase()) ?? false
      }
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (open) setShown(choice.harness)
        else setQuery("")
      }}
    >
      <ComboboxPrimitive.Trigger
        title={`${HARNESS_LABELS[choice.harness]} model`}
        className={TRIGGER_CLASS}
      >
        <HarnessLogo harness={choice.harness} className="size-3.5" />
        <span className="max-w-40 truncate">
          {choice.option?.name ?? "Model"}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0"
          strokeWidth={2}
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <ComboboxPrimitive.Popup
            className={cn(
              "flex origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none not-dark:bg-clip-padding",
              sidebar ? "h-80 w-80" : "w-64"
            )}
          >
            {sidebar && (
              <div className="flex w-11 shrink-0 flex-col gap-1 border-r border-border/70 bg-muted/30 p-1">
                {harnesses.map((harness) => (
                  <HoverSideTooltip
                    key={harness}
                    side="left"
                    tooltip={
                      <div className="flex max-w-56 flex-col gap-0.5">
                        <span className="font-medium">
                          {HARNESS_LABELS[harness]}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {HARNESS_TOOLTIPS[harness]}
                        </span>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      aria-label={HARNESS_LABELS[harness]}
                      aria-pressed={!searching && shown === harness}
                      onClick={() => showAgent(harness)}
                      className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.06] aria-pressed:bg-foreground/[0.08]"
                    >
                      <HarnessLogo harness={harness} className="size-5" />
                    </button>
                  </HoverSideTooltip>
                ))}
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border/70 py-1.5 ps-3 pe-2">
                <ComboboxPrimitive.Input
                  ref={inputRef}
                  placeholder="Search models"
                  className="h-6 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              <ComboboxPrimitive.Empty className="px-3 py-2 text-[13px] text-muted-foreground empty:hidden">
                {searching ? "No models match" : "Loading models…"}
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List
                className={cn(
                  "overflow-y-auto p-1 empty:hidden",
                  sidebar ? "min-h-0 flex-1" : "max-h-80"
                )}
              >
                {(key: string) => {
                  const item = byKey.get(key)
                  return (
                    <HoverSideTooltip key={key} tooltip={item?.detail}>
                      <ComboboxPrimitive.Item
                        value={key}
                        className="group flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        {sidebar && searching && item && (
                          <HarnessLogo
                            harness={item.harness}
                            className="size-3.5"
                          />
                        )}
                        <span className="min-w-0 truncate">
                          {item?.name ?? key}
                        </span>
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="ml-auto size-3.5 shrink-0 opacity-0 group-data-selected:opacity-100"
                          strokeWidth={2}
                        />
                      </ComboboxPrimitive.Item>
                    </HoverSideTooltip>
                  )
                }}
              </ComboboxPrimitive.List>
            </div>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </Combobox>
  )
}

const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

const effortLabel = (level: string) =>
  EFFORT_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1)

// Shown only for a model with effort levels or fast mode. "Default" leaves
// the effort to a harness that has its own (Claude Code).
export function EffortPicker({ choice }: { choice: ModelChoice }) {
  const { option, harness } = choice
  if (!option || (option.efforts.length === 0 && !option.fast)) return null
  const efforts = option.efforts.length > 0
  const harnessDefault = choice.catalog?.defaultEffort == null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title={efforts ? "Thinking effort" : "Fast mode"}
        className={TRIGGER_CLASS}
      >
        {efforts && (
          <HugeiconsIcon
            icon={BrainIcon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
        )}
        {efforts
          ? choice.effort
            ? effortLabel(choice.effort)
            : "Default"
          : "Fast mode"}
        {choice.fast && (
          <HugeiconsIcon
            icon={FlashIcon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
        )}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {efforts && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Thinking effort</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={choice.effort ?? ""}
              onValueChange={(value) =>
                rememberEffort(harness, value ? String(value) : null)
              }
            >
              {harnessDefault && (
                <DropdownMenuRadioItem value="">Default</DropdownMenuRadioItem>
              )}
              {option.efforts.map((level) => (
                <DropdownMenuRadioItem key={level} value={level}>
                  {effortLabel(level)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        )}
        {efforts && option.fast && <DropdownMenuSeparator />}
        {option.fast && (
          <HoverSideTooltip tooltip="Faster output from the same model, at a higher price. On a Claude plan it uses extra usage.">
            <DropdownMenuCheckboxItem
              variant="switch"
              checked={choice.fast}
              onCheckedChange={(checked) => rememberFast(harness, checked)}
            >
              Fast mode
            </DropdownMenuCheckboxItem>
          </HoverSideTooltip>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
