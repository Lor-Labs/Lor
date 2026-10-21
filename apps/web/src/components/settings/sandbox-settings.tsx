import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Separator } from "@repo/ui/components/separator"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

type SandboxMode = "manual" | "auto" | "bypass"
type SandboxSettingsValue = { sandboxMode: SandboxMode }

const SANDBOX_SETTINGS_KEY = ["sandbox-settings"] as const

const SANDBOX_MODE_OPTIONS = [
  {
    value: "manual",
    label: "Manual",
    detail: "Lor asks before every command and file change.",
  },
  {
    value: "auto",
    label: "Auto",
    detail: "Lor runs routine commands and asks before risky ones.",
  },
  {
    value: "bypass",
    label: "Bypass",
    detail: "Lor runs every command and file change without asking.",
  },
] as const

export function SandboxSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isPending } = useQuery({
    queryKey: SANDBOX_SETTINGS_KEY,
    queryFn: async () => {
      const res = await apiClient.v1["sandbox-settings"].$get()
      if (!res.ok) throw new Error("Failed to fetch sandbox settings")
      return res.json() as Promise<SandboxSettingsValue>
    },
  })

  // The select shows the new value at once; a failure puts the old one back.
  const { mutate: updateSettings } = useMutation({
    mutationFn: async (update: SandboxSettingsValue) => {
      const res = await apiClient.v1["sandbox-settings"].$patch({
        json: update,
      })
      if (!res.ok) throw new Error("Failed to update sandbox settings")
      return res.json() as Promise<SandboxSettingsValue>
    },
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: SANDBOX_SETTINGS_KEY })
      const previous =
        queryClient.getQueryData<SandboxSettingsValue>(SANDBOX_SETTINGS_KEY)
      queryClient.setQueryData<SandboxSettingsValue>(
        SANDBOX_SETTINGS_KEY,
        update
      )
      return { previous }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SANDBOX_SETTINGS_KEY, data)
    },
    onError: (_err, _update, context) => {
      queryClient.setQueryData(SANDBOX_SETTINGS_KEY, context?.previous)
      toast.error("Failed to update sandbox setting")
    },
  })

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const mode = settings?.sandboxMode ?? "auto"
  const selected = SANDBOX_MODE_OPTIONS.find((opt) => opt.value === mode)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Sandbox</h3>
        <p className="text-sm text-muted-foreground">
          Each session has its own sandbox, where Lor runs commands and changes
          files.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="sandbox-mode">Approval mode</Label>
        <p className="text-xs text-muted-foreground">
          When Lor asks before it runs a command or changes a file in turns you
          start. Anyone in the session can answer. Reading files never asks.
        </p>
        <Select
          items={SANDBOX_MODE_OPTIONS}
          value={mode}
          onValueChange={(value) =>
            value && updateSettings({ sandboxMode: value as SandboxMode })
          }
        >
          <SelectTrigger id="sandbox-mode" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SANDBOX_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <p className="text-xs text-muted-foreground">{selected.detail}</p>
        )}
      </div>
    </div>
  )
}
