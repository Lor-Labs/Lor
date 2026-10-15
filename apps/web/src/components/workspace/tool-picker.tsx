import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Checkbox } from "@repo/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { useId, useState } from "react"
import { SettingsGroup } from "./settings-group"

export type SelectableTool = {
  name: string
  label?: string
  description: string
  readOnlyHint?: boolean
}

type AccessMode = "recommended" | "readOnly" | "all" | "custom" | "off"

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
  const readOnly = tools
    .filter((tool) => tool.readOnlyHint === true)
    .map((tool) => tool.name)
  const all = tools.map((tool) => tool.name)
  const presets: Record<Exclude<AccessMode, "custom">, readonly string[]> = {
    recommended: recommended ?? [],
    readOnly,
    all,
    off: [],
  }
  const matches = (names: readonly string[]) =>
    selected.size === names.length && names.every((name) => selected.has(name))
  const inferredMode: AccessMode =
    selected.size === 0
      ? "off"
      : recommended && matches(recommended)
        ? "recommended"
        : matches(readOnly)
          ? "readOnly"
          : matches(all)
            ? "all"
            : "custom"
  const [choice, setChoice] = useState<AccessMode | null>(null)
  const [expanded, setExpanded] = useState(
    providerHints || inferredMode === "custom"
  )
  const options: { value: AccessMode; label: string }[] = [
    ...(recommended
      ? [{ value: "recommended" as const, label: "Recommended" }]
      : []),
    ...(readOnly.length > 0
      ? [{ value: "readOnly" as const, label: "Read only" }]
      : []),
    ...(all.length !== readOnly.length
      ? [
          {
            value: "all" as const,
            label: providerHints ? "All tools" : "Read & write",
          },
        ]
      : []),
    { value: "custom", label: "Custom" },
    { value: "off", label: "Off" },
  ]

  // Keep Custom open even when a checkbox happens to complete a preset.
  const mode =
    choice === "custom" ||
    (choice &&
      options.some((option) => option.value === choice) &&
      matches(presets[choice]))
      ? choice
      : inferredMode

  return (
    <SettingsGroup>
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div id={`${id}-label`} className="text-sm">
            Tool access
          </div>
          <div className="text-xs text-muted-foreground" aria-live="polite">
            {selected.size === 0
              ? "No tools enabled"
              : `${selected.size} of ${tools.length} enabled`}
          </div>
        </div>
        <Select<AccessMode>
          value={mode}
          items={options}
          disabled={disabled}
          onValueChange={(value) => {
            if (!value) return
            setChoice(value)
            if (value === "custom") setExpanded(true)
            else onChange(new Set(presets[value]))
          }}
        >
          <SelectTrigger
            aria-labelledby={`${id}-label`}
            className="w-full sm:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-tools`}
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-2.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HugeiconsIcon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            className="size-3.5"
            strokeWidth={2}
          />
          {expanded ? "Hide tools" : "Review tools"}
        </button>
        {expanded && (
          <div id={`${id}-tools`} className="divide-y divide-border pb-1">
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
                      setChoice("custom")
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
                              ? "Declared read only by the MCP provider."
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
          </div>
        )}
      </div>
    </SettingsGroup>
  )
}
