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
import { useQueries } from "@tanstack/react-query"
import { useState } from "react"
import {
  HARNESS_LABELS,
  HARNESS_TOOLTIPS,
  type SessionHarness,
} from "@/components/session/harness-picker"
import {
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
  description: string | null
  search: string
}

// The combobox holds string keys, unique across harnesses, so its value
// stays the same between renders.
type ModelGroup = { harness: SessionHarness; items: string[] }
const itemKey = (harness: SessionHarness, id: string) => `${harness}:${id}`

// More than one harness (a new code session): picking a model also picks
// its agent. Lor's long list goes last so the short ones stay in view.
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
  const ordered = [...harnesses].sort(
    (a, b) => Number(a === "pi") - Number(b === "pi")
  )
  const catalogs = useQueries({
    queries: ordered.map((harness) => agentModelsQueryOptions(harness)),
  })
  const byKey = new Map<string, ModelItem>()
  const groups: ModelGroup[] = []
  ordered.forEach((harness, index) => {
    const models = catalogs[index]?.data?.models ?? []
    for (const model of models) {
      byKey.set(itemKey(harness, model.id), {
        harness,
        id: model.id,
        name: model.name,
        description: model.description,
        search: [model.name, model.id, model.provider, HARNESS_LABELS[harness]]
          .join(" ")
          .toLowerCase(),
      })
    }
    if (models.length > 0) {
      groups.push({
        harness,
        items: models.map((model) => itemKey(harness, model.id)),
      })
    }
  })
  const selected = choice.option
    ? itemKey(choice.harness, choice.option.id)
    : null
  const showHarness = harnesses.length > 1

  return (
    <Combobox<string>
      items={groups}
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
        if (!open) setQuery("")
      }}
    >
      <ComboboxPrimitive.Trigger title="Model" className={TRIGGER_CLASS}>
        {showHarness && (
          <span className="shrink-0 text-foreground/80">
            {HARNESS_LABELS[choice.harness]}
          </span>
        )}
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
          <ComboboxPrimitive.Popup className="w-64 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none not-dark:bg-clip-padding">
            <div className="border-b border-border/70 py-1.5 ps-3 pe-2">
              <ComboboxPrimitive.Input
                placeholder="Search models"
                className="h-6 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-[13px] text-muted-foreground empty:hidden">
              No models match
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-80 overflow-y-auto p-1 empty:hidden">
              {(group: ModelGroup) => (
                <ComboboxPrimitive.Group
                  key={group.harness}
                  items={group.items}
                  className="[[role=group]+&]:mt-1"
                >
                  {showHarness && (
                    <ComboboxPrimitive.GroupLabel
                      title={HARNESS_TOOLTIPS[group.harness]}
                      className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
                    >
                      {HARNESS_LABELS[group.harness]}
                    </ComboboxPrimitive.GroupLabel>
                  )}
                  <ComboboxPrimitive.Collection>
                    {(key: string) => (
                      <HoverSideTooltip
                        key={key}
                        tooltip={byKey.get(key)?.description}
                      >
                        <ComboboxPrimitive.Item
                          value={key}
                          className="group flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                        >
                          <span className="min-w-0 truncate">
                            {byKey.get(key)?.name ?? key}
                          </span>
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="ml-auto size-3.5 shrink-0 opacity-0 group-data-selected:opacity-100"
                            strokeWidth={2}
                          />
                        </ComboboxPrimitive.Item>
                      </HoverSideTooltip>
                    )}
                  </ComboboxPrimitive.Collection>
                </ComboboxPrimitive.Group>
              )}
            </ComboboxPrimitive.List>
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
