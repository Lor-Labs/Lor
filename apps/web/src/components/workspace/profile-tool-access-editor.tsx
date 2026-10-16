import {
  ApiIcon,
  ArrowRight01Icon,
  CloudServerIcon,
  File02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  hasUnavailableProfileSelections,
  type ProfileToolGroup,
  profileGroupNote,
  profileGroupSelection,
  profileGroupSummary,
  profileSelectedTools,
  removeUnavailableProfileSelections,
  setProfileGroupSelection,
} from "@repo/connectors"
import type { ProfileToolAccess, ProfileToolSelection } from "@repo/db/schema"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { Switch } from "@repo/ui/components/switch"
import { cn } from "@repo/ui/lib/utils"
import { useId, useState } from "react"
import {
  DISCLOSURE_MOTION,
  IconTile,
  SettingsAction,
  SettingsGroup,
  SettingsLink,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { ToolChecklist } from "@/components/workspace/tool-picker"
import { connectorLogo, isConnectorKey } from "@/lib/connector-ui"

export function ProfileServiceIcon({
  group,
  className,
}: {
  group: ProfileToolGroup
  className?: string
}) {
  if (
    (group.kind === "connector" && isConnectorKey(group.id)) ||
    (group.kind === "builtin" && group.id === "web")
  ) {
    const Logo = connectorLogo(isConnectorKey(group.id) ? group.id : null)
    return <Logo className={className} />
  }
  const icon =
    group.kind === "builtin"
      ? File02Icon
      : group.kind === "customTools"
        ? ApiIcon
        : CloudServerIcon
  return <HugeiconsIcon icon={icon} className={className} strokeWidth={2} />
}

// Switch off = Off. Switch on = follow the workspace. Changing a checkbox
// saves an explicit custom list, which stops following new workspace tools.
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
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const selection = profileGroupSelection(access, group)
  const mode = selection?.mode ?? "workspace"
  const names = group.tools.map((tool) => tool.name)
  const selected = profileSelectedTools(names, selection)
  const expandable = mode !== "off" && group.tools.length > 0
  const select = (next: ProfileToolSelection) =>
    onChange(setProfileGroupSelection(access, group, next))

  return (
    <Collapsible
      open={open && expandable}
      onOpenChange={setOpen}
      disabled={!expandable}
    >
      <div className="flex items-center gap-3">
        <CollapsibleTrigger
          onClick={(event) => setInstant(event.detail === 0)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <IconTile size="sm">
            <ProfileServiceIcon group={group} className="size-4" />
          </IconTile>
          <span className="min-w-0 flex-1">
            <span id={id} className="block text-sm break-words">
              {group.name}
            </span>
            <span className="block text-xs text-muted-foreground">
              {profileGroupSummary(group, selection)}
            </span>
          </span>
          {expandable && (
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                open && "rotate-90",
                instant && "transition-none"
              )}
              strokeWidth={2}
            />
          )}
        </CollapsibleTrigger>
        <Switch
          aria-labelledby={id}
          checked={mode !== "off"}
          onCheckedChange={(checked) => {
            if (!checked) setOpen(false)
            select(checked ? { mode: "workspace" } : { mode: "off" })
          }}
        />
      </div>
      <CollapsiblePanel
        className={cn(
          DISCLOSURE_MOTION,
          instant && "transition-none motion-reduce:transition-none"
        )}
      >
        <div className="ml-11 border-t border-border">
          <ToolChecklist
            tools={group.tools}
            selected={new Set(selected)}
            // Only built-in and connector catalogs declare reads for sure.
            providerHints={
              group.kind === "mcpServer" || group.kind === "customTools"
            }
            onChange={(next) =>
              select({
                mode: "custom",
                tools: names.filter((name) => next.has(name)),
              })
            }
          />
          <div className="flex items-center justify-between gap-3 border-t border-border py-3 text-xs text-muted-foreground">
            <span>{profileGroupNote(group, selection)}</span>
            {mode === "custom" && (
              <SettingsAction onClick={() => select({ mode: "workspace" })}>
                Use all tools
              </SettingsAction>
            )}
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function ProfileToolAccessEditor({
  groups,
  value,
  onChange,
  onOpenTools,
}: {
  groups: ProfileToolGroup[]
  value: ProfileToolAccess
  onChange: (access: ProfileToolAccess) => void
  onOpenTools: () => void
}) {
  const rows = (kinds: ProfileToolGroup["kind"][]) =>
    groups
      .filter((group) => kinds.includes(group.kind))
      .map((group) => (
        <ServiceTools
          key={`${group.kind}:${group.id}`}
          group={group}
          access={value}
          onChange={onChange}
        />
      ))
  const services = rows(["connector", "mcpServer"])
  const apiTools = groups.find((group) => group.kind === "customTools")

  return (
    <div className="space-y-6">
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
      <SettingsSection title="Built-in tools">
        <SettingsGroup>{rows(["builtin"])}</SettingsGroup>
      </SettingsSection>
      <SettingsSection title="Connected services">
        <SettingsGroup>
          {services}
          {services.length === 0 && (
            <div className="py-3 text-sm text-muted-foreground">
              No connectors or MCP servers connected yet. This profile will use
              their tools when you connect them.
            </div>
          )}
        </SettingsGroup>
      </SettingsSection>
      {apiTools && (
        <SettingsSection
          title="API tools"
          caption={
            apiTools.tools.length === 0 && (
              <>
                Add API tools in{" "}
                <SettingsLink onClick={onOpenTools}>Tools</SettingsLink>.
              </>
            )
          }
        >
          <SettingsGroup>{rows(["customTools"])}</SettingsGroup>
        </SettingsSection>
      )}
    </div>
  )
}
