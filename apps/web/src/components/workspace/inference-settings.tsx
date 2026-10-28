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
        throw new Error(
          "Could not update AI settings. Check the selected model and API key."
        )
      return res.json()
    },
    onSuccess: (result) => {
      setApiKey("")
      client.setQueryData(queryKey, result)
      void client.invalidateQueries({ queryKey: ["agent-models"] })
      toast.success(
        result.key
          ? "API key saved. Your next response will use it."
          : "API key removed. New responses will use Lor credits."
      )
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <div className="space-y-3 rounded-lg border p-5">
      <h4 className="font-medium">AI provider</h4>
      {isError ? (
        <p className="text-sm text-muted-foreground">
          AI settings could not be loaded. Reopen billing to retry.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {data?.key
            ? `Using ${data.key.provider} · ${data.key.model} · key ending ${data.key.lastFour}`
            : "Using Lor credits"}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Bring an Anthropic or OpenAI API key for your team's agent responses.
        Your provider bills you directly; Lor credits are not used. Search and
        other included services stay included. Compute limits and the trial end
        date still apply. Choose a default here; each message can use another
        model supported by your provider.
      </p>
      {!expired && data && (
        <>
          <Select
            value={provider}
            onValueChange={(value) => {
              if (value === "anthropic" || value === "openai")
                setProvider(value)
              setModel("")
            }}
          >
            <SelectTrigger aria-label="AI provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={model}
            onValueChange={(value) => setModel(value ?? "")}
          >
            <SelectTrigger aria-label="Default AI model">
              <SelectValue placeholder="Choose a default model" />
            </SelectTrigger>
            <SelectContent>
              {data.models
                .filter((item) => item.provider === provider)
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Provider API key"
            type="password"
            autoComplete="off"
            placeholder="Paste a provider API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            disabled={!model || !apiKey.trim() || save.isPending}
            onClick={() => save.mutate(false)}
          >
            Save API key
          </Button>
          <p className="text-xs text-muted-foreground">
            Keys are encrypted and used on the server. Saving does not validate
            provider access; an invalid key pauses the response without falling
            back to Lor credits. Subscription tokens are not supported.
          </p>
        </>
      )}
      {data?.key && (
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate(true)}
        >
          Remove key
        </Button>
      )}
    </div>
  )
}
