import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { IntegrationStatus } from "@/lib/api-types"
import {
  DISCLOSURE_MOTION,
  PILL_BUTTON,
  SettingsAction,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"
import { ToolPicker } from "./tool-picker"

const PREVIEW_LIMIT = 4

function PreviewToolRow({
  tool,
}: {
  tool: IntegrationStatus["tools"][number]
}) {
  return (
    <div className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{tool.label}</span>
        {tool.readOnlyHint === true && (
          <Badge variant="secondary">Read only</Badge>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {tool.description}
      </p>
    </div>
  )
}

export function ConnectorToolPreview({
  tools,
}: {
  tools: IntegrationStatus["tools"]
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [instant, setInstant] = useState(false)
  const remaining = tools.slice(PREVIEW_LIMIT)

  return (
    <SettingsSection title="Available tools" count={tools.length}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SettingsGroup>
          <div>
            <div className="divide-y divide-border">
              {tools.slice(0, PREVIEW_LIMIT).map((tool) => (
                <PreviewToolRow key={tool.name} tool={tool} />
              ))}
            </div>
            {remaining.length > 0 && (
              <CollapsiblePanel
                id={id}
                className={cn(
                  DISCLOSURE_MOTION,
                  instant && "transition-none motion-reduce:transition-none"
                )}
              >
                <div className="divide-y divide-border border-t border-border">
                  {remaining.map((tool) => (
                    <PreviewToolRow key={tool.name} tool={tool} />
                  ))}
                </div>
              </CollapsiblePanel>
            )}
          </div>
        </SettingsGroup>
        {remaining.length > 0 && (
          <CollapsibleTrigger
            aria-controls={id}
            onClick={(event) => setInstant(event.detail === 0)}
            className="mt-2 cursor-pointer rounded-sm px-4 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? "Show fewer tools" : `Show all ${tools.length} tools`}
          </CollapsibleTrigger>
        )}
      </Collapsible>
    </SettingsSection>
  )
}

export function ConnectorToolSettings({
  workspaceSlug,
  provider,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(() => new Set(provider.enabledTools))
  const matches = (names: readonly string[]) =>
    selected.size === names.length && names.every((name) => selected.has(name))
  const dirty = !matches(provider.enabledTools)
  const recommended = provider.tools
    .filter((tool) => tool.defaultEnabled)
    .map((tool) => tool.name)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!provider.connectionId) throw new Error("Connect this provider first")
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].tools.$patch({
        param: { workspaceSlug, connectionId: provider.connectionId },
        json: { enabledTools: [...selected] },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Couldn't save tool selection")
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["integrations", workspaceSlug],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-profiles", workspaceSlug],
        }),
      ])
      toast.success("Tool selection saved")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <SettingsSection
      title="Tools"
      action={
        provider.canManage &&
        !mutation.isPending &&
        !matches(recommended) && (
          <SettingsAction onClick={() => setSelected(new Set(recommended))}>
            Reset to defaults
          </SettingsAction>
        )
      }
    >
      <ToolPicker
        tools={provider.tools}
        selected={selected}
        onChange={setSelected}
        disabled={!provider.canManage || mutation.isPending}
      />
      {provider.canManage && dirty && (
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className={PILL_BUTTON}
            disabled={mutation.isPending}
            onClick={() => setSelected(new Set(provider.enabledTools))}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className={PILL_BUTTON}
            loading={mutation.isPending}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save changes
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
