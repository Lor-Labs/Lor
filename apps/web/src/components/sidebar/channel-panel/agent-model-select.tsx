import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Combobox, ComboboxPrimitive } from "@repo/ui/components/combobox"
import { CHANNEL_AGENT_DEFAULT_MODEL } from "@repo/utils/inference"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { agentModelsQueryOptions } from "@/hooks/use-agent-models"

// The channel agent's model: one of Lor's own models (it runs on Lor's
// credits), searchable since the list is long. Null keeps the default.
export function AgentModelSelect({
  workspaceSlug,
  value,
  onChange,
  id,
}: {
  workspaceSlug: string
  value: string | null
  onChange: (model: string | null) => void
  id?: string
}) {
  const [query, setQuery] = useState("")
  const { data } = useQuery(agentModelsQueryOptions("pi", workspaceSlug))
  // Lor's own models; batch-only ones can't answer live.
  const models = (data?.models ?? []).filter(
    (model) => model.keyProvider === null && !model.id.endsWith("-batch")
  )
  const nameOf = (modelId: string) =>
    models.find((model) => model.id === modelId)?.name ?? modelId
  const selected = value ?? CHANNEL_AGENT_DEFAULT_MODEL
  const items = models.map((model) => model.id)

  return (
    <Combobox<string>
      items={items}
      value={selected}
      onValueChange={(modelId) => {
        if (!modelId) return
        onChange(modelId === CHANNEL_AGENT_DEFAULT_MODEL ? null : modelId)
      }}
      itemToStringLabel={nameOf}
      filter={(modelId: string, text) =>
        `${nameOf(modelId)} ${modelId}`
          .toLowerCase()
          .includes(text.trim().toLowerCase())
      }
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <span className="min-w-0 truncate">
          {nameOf(selected)}
          {value === null && (
            <span className="text-muted-foreground"> (default)</span>
          )}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="ml-auto size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <ComboboxPrimitive.Popup className="flex w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none not-dark:bg-clip-padding">
            <div className="shrink-0 border-b border-border/70 py-1.5 ps-3 pe-2">
              <ComboboxPrimitive.Input
                placeholder="Search models"
                className="h-6 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-[13px] text-muted-foreground empty:hidden">
              {query.trim() ? "No models match" : "Loading models…"}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-72 overflow-y-auto p-1 empty:hidden">
              {(modelId: string) => (
                <ComboboxPrimitive.Item
                  key={modelId}
                  value={modelId}
                  className="group flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="min-w-0 truncate">
                    {nameOf(modelId)}
                    {modelId === CHANNEL_AGENT_DEFAULT_MODEL && (
                      <span className="text-muted-foreground"> (default)</span>
                    )}
                  </span>
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="ml-auto size-3.5 shrink-0 opacity-0 group-data-selected:opacity-100"
                    strokeWidth={2}
                  />
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </Combobox>
  )
}
