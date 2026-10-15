import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { useId, useState } from "react"
import { SettingsGroup } from "./settings-group"

export type SelectableTool = {
  name: string
  label?: string
  description: string
  readOnlyHint?: boolean
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<\/?[a-z_]+>/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

export function ToolPicker({
  tools,
  selected,
  onChange,
  disabled = false,
  recommended,
  providerHints = false,
}: {
  tools: readonly SelectableTool[]
  selected: ReadonlySet<string>
  onChange: (names: Set<string>) => void
  disabled?: boolean
  recommended?: readonly string[]
  providerHints?: boolean
}) {
  const id = useId()
  const [customizing, setCustomizing] = useState(providerHints)
  const readOnly = tools
    .filter((tool) => tool.readOnlyHint === true)
    .map((tool) => tool.name)
  const all = tools.map((tool) => tool.name)
  const matches = (names: readonly string[]) =>
    selected.size === names.length && names.every((name) => selected.has(name))
  const choose = (names: readonly string[]) => onChange(new Set(names))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={matches(readOnly) ? "secondary" : "ghost"}
          size="sm"
          disabled={disabled || readOnly.length === 0}
          aria-pressed={readOnly.length > 0 && matches(readOnly)}
          onClick={() => choose(readOnly)}
        >
          {providerHints ? "Select read only" : "Read only"}
        </Button>
        {all.length !== readOnly.length && (
          <Button
            type="button"
            variant={matches(all) ? "secondary" : "ghost"}
            size="sm"
            disabled={disabled}
            aria-pressed={matches(all)}
            onClick={() => choose(all)}
          >
            {providerHints ? "Select all" : "Read & write"}
          </Button>
        )}
        {recommended && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => choose(recommended)}
          >
            Use defaults
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => choose([])}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={customizing}
          aria-controls={`${id}-tools`}
          onClick={() => setCustomizing((value) => !value)}
        >
          Customize tools
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {selected.size} of {tools.length} selected
        </span>
      </div>
      {providerHints && (
        <p className="px-4 text-xs text-muted-foreground">
          Read only labels are declared by the MCP provider. Review the tools
          you enable; labels do not replace permissions or approvals.
        </p>
      )}
      {customizing && (
        <div id={`${id}-tools`}>
          <SettingsGroup>
            {tools.map((tool, index) => {
              const description = cleanDescription(tool.description)
              return (
                <div key={tool.name} className="flex items-start gap-3 py-3">
                  <Checkbox
                    id={`${id}-${index}`}
                    className="mt-0.5"
                    checked={selected.has(tool.name)}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected)
                      if (checked === true) next.add(tool.name)
                      else next.delete(tool.name)
                      onChange(next)
                    }}
                  />
                  <label
                    htmlFor={`${id}-${index}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={
                          tool.label ? undefined : "font-mono break-all"
                        }
                      >
                        {tool.label ?? tool.name}
                      </span>
                      {tool.readOnlyHint === true && (
                        <Badge
                          variant="secondary"
                          title={
                            providerHints
                              ? "The MCP provider declares this tool read only. This is a hint, not a guarantee."
                              : "This tool reads data without changing it."
                          }
                        >
                          Read only
                        </Badge>
                      )}
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
                </div>
              )
            })}
          </SettingsGroup>
        </div>
      )}
    </div>
  )
}
