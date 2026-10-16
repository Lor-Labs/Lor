import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  cleanToolDescription,
  type GroupableTool,
  type ToolGroup,
  toolGroups,
} from "@repo/connectors"
import { Checkbox } from "@repo/ui/components/checkbox"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useId, useState } from "react"
import { DISCLOSURE_MOTION, SettingsGroup } from "./settings-group"

type ToolPickerProps = {
  tools: readonly GroupableTool[]
  selected: ReadonlySet<string>
  onChange: (names: Set<string>) => void
  disabled?: boolean
  providerHints?: boolean
}

export function ToolPicker(props: ToolPickerProps) {
  return (
    <div className="space-y-2">
      <SettingsGroup>
        <ToolChecklist {...props} defaultExpanded={props.providerHints} />
      </SettingsGroup>
      <p className="px-4 text-xs text-muted-foreground">
        {props.providerHints && "Read only labels come from the server. "}New
        tools stay off until you turn them on.
      </p>
    </div>
  )
}

// The grouped checkboxes without a surface, for embedding inside another row.
// Partly selected groups always start open.
export function ToolChecklist({
  tools,
  selected,
  onChange,
  disabled = false,
  providerHints = false,
  defaultExpanded = false,
  rowAction,
}: ToolPickerProps & {
  defaultExpanded?: boolean
  // A control at the end of a tool's row, outside its label.
  rowAction?: (tool: GroupableTool) => ReactNode
}) {
  const id = useId()
  const groups = toolGroups(tools, providerHints)
  const countIn = (group: ToolGroup) =>
    group.tools.filter((tool) => selected.has(tool.name)).length
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        groups
          .filter((group) => {
            const count = countIn(group)
            return defaultExpanded || (count > 0 && count < group.tools.length)
          })
          .map((group) => group.key)
      )
  )
  const [instant, setInstant] = useState(false)

  const setOpen = (key: ToolGroup["key"], open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })

  const setTools = (names: string[], on: boolean) => {
    const next = new Set(selected)
    for (const name of names) {
      if (on) next.add(name)
      else next.delete(name)
    }
    onChange(next)
  }

  return (
    <div className="divide-y divide-border">
      {groups.map((group) => {
        const count = countIn(group)
        const open = expanded.has(group.key)
        const labelId = `${id}-${group.key}`
        return (
          <Collapsible
            key={group.key}
            open={open}
            onOpenChange={(next) => setOpen(group.key, next)}
          >
            <div className="flex items-center gap-3">
              <Checkbox
                aria-labelledby={labelId}
                checked={count === group.tools.length}
                indeterminate={count > 0 && count < group.tools.length}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setTools(
                    group.tools.map((tool) => tool.name),
                    checked
                  )
                }
              />
              <CollapsibleTrigger
                onClick={(event) => setInstant(event.detail === 0)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span id={labelId} className="flex-1 text-sm">
                  {group.label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count} of {group.tools.length}
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                    open && "rotate-90",
                    instant && "transition-none"
                  )}
                  strokeWidth={2}
                />
              </CollapsibleTrigger>
            </div>
            <CollapsiblePanel
              className={cn(
                DISCLOSURE_MOTION,
                instant && "transition-none motion-reduce:transition-none"
              )}
            >
              <div className="ml-7.5 divide-y divide-border border-t border-border sm:ml-7">
                {group.tools.map((tool, index) => {
                  const toolId = `${labelId}-${index}`
                  const description = cleanToolDescription(tool.description)
                  return (
                    <div
                      key={tool.name}
                      className="flex items-start gap-3 py-3"
                    >
                      <Checkbox
                        id={toolId}
                        className="mt-0.5"
                        checked={selected.has(tool.name)}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          setTools([tool.name], checked)
                        }
                      />
                      <label
                        htmlFor={toolId}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <span
                          className={cn(
                            "block text-sm",
                            !tool.label && "font-mono break-all"
                          )}
                        >
                          {tool.label ?? tool.name}
                        </span>
                        {description && (
                          <span
                            className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground"
                            title={description}
                          >
                            {description}
                          </span>
                        )}
                      </label>
                      {rowAction?.(tool)}
                    </div>
                  )
                })}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        )
      })}
    </div>
  )
}
