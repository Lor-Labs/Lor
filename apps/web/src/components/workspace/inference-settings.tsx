import { Key01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"
import {
  PILL_BUTTON,
  SettingsDisclosureRow,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
] as const

const providerLabel = (value: string) =>
  PROVIDERS.find((p) => p.value === value)?.label ?? value

export function InferenceSettings({
  workspaceSlug,
  expired,
}: {
  workspaceSlug: string
  expired: boolean
}) {
  const client = useQueryClient()
  const endpoint = apiClient.v1.workspaces[":workspaceSlug"].billing.inference
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const queryKey = ["workspace-inference", workspaceSlug]
  const { data, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await endpoint.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load AI settings")
      return res.json()
    },
  })
  const save = useMutation({
    mutationFn: async (remove: boolean) => {
      const res = remove
        ? await endpoint.$delete({ param: { workspaceSlug } })
        : await endpoint.$put({
            param: { workspaceSlug },
            json: { provider, model, apiKey },
          })
      if (!res.ok)
        throw new Error("Could not save the key. Check the model and key.")
      return res.json()
    },
    onSuccess: (result) => {
      setApiKey("")
      client.setQueryData(queryKey, result)
      void client.invalidateQueries({ queryKey: ["agent-models"] })
      toast.success(result.key ? "API key saved" : "API key removed")
    },
    onError: (error) => toast.error(error.message),
  })

  const key = data?.key
  const models = (data?.models ?? [])
    .filter((item) => item.provider === provider)
    .map((item) => ({ value: item.id, label: item.name }))
  const title = key
    ? `${providerLabel(key.provider)} · ${key.model}`
    : "Use your own key"
  const summary = isError
    ? "Couldn't load"
    : key
      ? `Key ending ${key.lastFour}`
      : "Anthropic or OpenAI"

  return (
    <SettingsSection
      title="Your AI key"
      caption="Your provider bills AI directly. Sandbox time still uses credits."
    >
      <SettingsGroup>
        <SettingsDisclosureRow
          icon={
            <HugeiconsIcon
              icon={Key01Icon}
              className="size-4"
              strokeWidth={2}
            />
          }
          title={title}
          summary={summary}
          disabled={!data || (expired && !key)}
        >
          <div className="space-y-3 py-3">
            {/* After the beta ends a key can still be removed, not changed. */}
            {!expired && (
              <div className="flex gap-2">
                <Select
                  items={PROVIDERS}
                  value={provider}
                  onValueChange={(value) => {
                    if (value === "anthropic" || value === "openai")
                      setProvider(value)
                    setModel("")
                  }}
                >
                  <SelectTrigger aria-label="Provider" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  items={models}
                  value={model}
                  onValueChange={(value) => setModel(value ?? "")}
                >
                  <SelectTrigger aria-label="Default model" className="flex-1">
                    <SelectValue placeholder="Default model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!expired && (
              <Input
                aria-label="API key"
                type="password"
                autoComplete="off"
                placeholder="API key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            )}
            <div className="flex gap-2">
              {!expired && (
                <Button
                  className={PILL_BUTTON}
                  disabled={!model || !apiKey.trim() || save.isPending}
                  onClick={() => save.mutate(false)}
                >
                  {key ? "Replace key" : "Save key"}
                </Button>
              )}
              {key && (
                <Button
                  variant="outline"
                  className={PILL_BUTTON}
                  disabled={save.isPending}
                  onClick={() => save.mutate(true)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </SettingsDisclosureRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
