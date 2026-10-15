import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { IntegrationStatus } from "@/lib/api-types"
import { SettingsSection } from "./settings-group"
import { ToolPicker } from "./tool-picker"

export function ConnectorToolSettings({
  workspaceSlug,
  provider,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(() => new Set(provider.enabledTools))
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
      await queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Tool selection saved")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <SettingsSection
      title="Tools Lor may use"
      count={provider.tools.length}
      caption="Agent profiles and approval rules still apply. New tools stay off until you enable them."
      action={
        provider.canManage && (
          <Button
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        )
      }
    >
      <ToolPicker
        tools={provider.tools}
        selected={selected}
        onChange={setSelected}
        disabled={!provider.canManage || mutation.isPending}
        recommended={provider.tools
          .filter((tool) => tool.defaultEnabled)
          .map((tool) => tool.name)}
      />
    </SettingsSection>
  )
}
