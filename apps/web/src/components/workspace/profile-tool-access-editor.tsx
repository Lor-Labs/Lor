import { CloudServerIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  hasUnavailableProfileSelections,
  PROFILE_TOOL_MODES,
  type ProfileToolGroup,
  profileGroupSelection,
  profileGroupSummary,
  profileSelectedTools,
  removeUnavailableProfileSelections,
  setProfileGroupSelection,
} from "@repo/connectors"
import type { ProfileToolAccess } from "@repo/db/schema"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { useId } from "react"
import { IconTile, SettingsGroup } from "@/components/workspace/settings-group"
import { connectorLogo, isConnectorKey } from "@/lib/connector-ui"

export function ProfileServiceIcon({
  group,
  className,
}: {
  group: ProfileToolGroup
  className?: string
}) {
  if (group.kind === "connector" && isConnectorKey(group.id)) {
    const Logo = connectorLogo(group.id)
    return <Logo className={className} />
  }
  return (
    <HugeiconsIcon
      icon={CloudServerIcon}
      className={className}
      strokeWidth={2}
    />
  )
}

function ServiceTools({
  group,
  access,
  onChange,
}: {
  group: ProfileToolGroup
  access: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
}) {
  const id = useId()
  const selection = profileGroupSelection(access, group)
  const mode = selection?.mode ?? "workspace"
  const selected = profileSelectedTools(
    group.tools.map((tool) => tool.name),
    selection
  )
  return (
    <SettingsGroup>
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <IconTile size="sm">
            <ProfileServiceIcon group={group} className="size-4" />
          </IconTile>
          <div className="min-w-0">
            <div id={id} className="text-sm font-medium break-words">
              {group.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {profileGroupSummary(group, selection)}
            </div>
          </div>
        </div>
        <Select
          value={mode}
          items={PROFILE_TOOL_MODES}
          onValueChange={(value) => {
            if (!value) return
            onChange(
              setProfileGroupSelection(
                access,
                group,
                value === "custom"
                  ? { mode: "custom", tools: selected }
                  : { mode: value }
              )
            )
          }}
        >
          <SelectTrigger
            aria-labelledby={id}
            className="w-full sm:w-48 sm:shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILE_TOOL_MODES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {mode === "custom" && (
        <div className="space-y-1 py-3">
          {group.tools.map((tool) => (
            <label
              htmlFor={`${id}-${tool.name}`}
              key={tool.name}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-accent/50"
            >
              <Checkbox
                id={`${id}-${tool.name}`}
                className="mt-0.5"
                checked={selected.includes(tool.name)}
                onCheckedChange={(checked) =>
                  onChange(
                    setProfileGroupSelection(access, group, {
                      mode: "custom",
                      tools: checked
                        ? [...selected, tool.name]
                        : selected.filter((name) => name !== tool.name),
                    })
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="break-words">{tool.label}</span>
                  {tool.readOnlyHint === true && (
                    <Badge variant="secondary">Read only</Badge>
                  )}
                </span>
                {tool.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {tool.description}
                  </span>
                )}
              </span>
            </label>
          ))}
          {group.tools.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No tools are enabled for this service in the workspace.
            </p>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}

export function ProfileToolAccessEditor({
  groups,
  value,
  onChange,
}: {
  groups: ProfileToolGroup[]
  value: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
}) {
  return (
    <div className="space-y-3">
      {hasUnavailableProfileSelections(value, groups) && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm">
            Some saved services or tools are no longer available. Remove those
            selections before saving. Removed services will follow workspace
            tools if connected again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange(removeUnavailableProfileSelections(value, groups))
            }
          >
            Remove unavailable selections
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {groups.map((group) => (
          <ServiceTools
            key={`${group.kind}:${group.id}`}
            group={group}
            access={value}
            onChange={onChange}
          />
        ))}
      </div>
      {groups.length === 0 && (
        <p className="py-3 text-sm text-muted-foreground">
          No connectors or MCP servers connected yet. This profile will use
          their workspace tools when you connect them.
        </p>
      )}
    </div>
  )
}
