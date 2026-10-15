import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { IntegrationStatus } from "@/lib/api-types"
import { PILL_BUTTON, SettingsGroup, SettingsSection } from "./settings-group"
import { ToolPicker } from "./tool-picker"

const PREVIEW_LIMIT = 4

export function ConnectorToolPreview({
  tools,
}: {
  tools: IntegrationStatus["tools"]
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? tools : tools.slice(0, PREVIEW_LIMIT)

  return (
    <SettingsSection title="Available tools" count={tools.length}>
      <div id={id}>
        <SettingsGroup>
          {visible.map((tool) => (
            <div key={tool.name} className="space-y-1 py-3">
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
          ))}
          {tools.length > PREVIEW_LIMIT && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={id}
              className="w-full cursor-pointer rounded-sm py-3 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer tools" : `Show all ${tools.length} tools`}
            </button>
          )}
        </SettingsGroup>
      </div>
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
  const [pickerRevision, setPickerRevision] = useState(0)
  const dirty =
    selected.size !== provider.enabledTools.length ||
    provider.enabledTools.some((name) => !selected.has(name))
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
    <SettingsSection title="Tools">
      <ToolPicker
        key={pickerRevision}
        tools={provider.tools}
        selected={selected}
        onChange={setSelected}
        disabled={!provider.canManage || mutation.isPending}
        recommended={provider.tools
          .filter((tool) => tool.defaultEnabled)
          .map((tool) => tool.name)}
      />
      {provider.canManage && dirty && (
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className={PILL_BUTTON}
            disabled={mutation.isPending}
            onClick={() => {
              setSelected(new Set(provider.enabledTools))
              setPickerRevision((revision) => revision + 1)
            }}
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
