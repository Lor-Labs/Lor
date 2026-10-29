import { Button } from "@repo/ui/components/button"
import { Reveal } from "@repo/ui/components/collapsible"
import { Input } from "@repo/ui/components/input"
import { toast } from "@repo/ui/components/toast"
import { formatDate } from "@repo/utils/date"
import {
  KEY_PROVIDER_NAMES,
  KEY_PROVIDERS,
  type KeyProvider,
} from "@repo/utils/inference"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import { apiClient } from "@/lib/api-client"
import {
  DISCLOSURE_MOTION,
  IconTile,
  PILL_BUTTON,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"

// The workspace's own Anthropic and OpenAI keys, one row each. Composer
// models listed under a key run on it; the rest use Lor credits.

const endpoint =
  apiClient.v1.workspaces[":workspaceSlug"].billing["provider-keys"]

async function fetchProviderKeys(workspaceSlug: string) {
  const res = await endpoint.$get({ param: { workspaceSlug } })
  if (!res.ok) throw new Error("Failed to load provider keys")
  return res.json()
}

type ProviderKeys = Awaited<ReturnType<typeof fetchProviderKeys>>

export function ProviderKeysSettings({
  workspaceSlug,
  expired,
}: {
  workspaceSlug: string
  expired: boolean
}) {
  const client = useQueryClient()
  const queryKey = ["provider-keys", workspaceSlug]
  const { data, isError } = useQuery({
    queryKey,
    queryFn: () => fetchProviderKeys(workspaceSlug),
  })
  const onChange = (keys: ProviderKeys) => {
    client.setQueryData(queryKey, keys)
    void client.invalidateQueries({ queryKey: ["agent-models"] })
  }

  return (
    <SettingsSection title="Provider keys">
      <SettingsGroup>
        {KEY_PROVIDERS.map((provider) => (
          <ProviderKeyRow
            key={provider}
            provider={provider}
            workspaceSlug={workspaceSlug}
            saved={data?.keys.find((key) => key.provider === provider)}
            status={isError ? "Couldn't load" : data ? null : "Loading"}
            expired={expired}
            onChange={onChange}
          />
        ))}
      </SettingsGroup>
    </SettingsSection>
  )
}

function ProviderKeyRow({
  provider,
  workspaceSlug,
  saved,
  status,
  expired,
  onChange,
}: {
  provider: KeyProvider
  workspaceSlug: string
  saved: ProviderKeys["keys"][number] | undefined
  status: string | null
  expired: boolean
  onChange: (keys: ProviderKeys) => void
}) {
  const name = KEY_PROVIDER_NAMES[provider]
  const [editing, setEditing] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const param = { workspaceSlug, provider }
  const close = () => {
    setEditing(false)
    setApiKey("")
    setError(null)
  }
  // The server checks the key with the provider before saving it; its
  // rejection shows under the field.
  const save = useMutation({
    mutationFn: async () => {
      const res = await endpoint[":provider"].$put({
        param,
        json: { apiKey },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          body && "message" in body
            ? body.message
            : "Couldn't save the key. Try again."
        )
      }
      return res.json()
    },
    onSuccess: (keys) => {
      onChange(keys)
      close()
    },
    onError: (err) => setError(err.message),
  })
  const remove = async () => {
    const res = await endpoint[":provider"].$delete({ param })
    if (!res.ok) {
      toast.error(`Couldn't remove the ${name} key`)
      throw new Error("Remove failed")
    }
    onChange(await res.json())
  }
  const summary =
    status ??
    (saved
      ? `Key ending ${saved.lastFour} · Added by ${saved.createdBy ?? "a former member"} on ${formatDate(saved.createdAt)}`
      : "No key")

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <IconTile size="sm">
          <HarnessLogo
            harness={provider === "anthropic" ? "claude_code" : "codex"}
            className="size-4"
          />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        {/* After the beta ends a key can still be removed, not changed. */}
        {!expired && !editing && (
          <Button
            variant="secondary"
            size="sm"
            className={PILL_BUTTON}
            disabled={status !== null}
            onClick={() => setEditing(true)}
          >
            {saved ? "Replace" : "Add key"}
          </Button>
        )}
        {saved && (
          <InlineConfirmButton
            label={`Remove ${name} key`}
            confirmLabel="Remove"
            onConfirm={remove}
          />
        )}
      </div>
      <Reveal open={editing} className={DISCLOSURE_MOTION}>
        <form
          className="ml-11 space-y-2 pt-3"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <Input
            aria-label={`${name} API key`}
            type="password"
            autoComplete="off"
            autoFocus
            placeholder={provider === "anthropic" ? "sk-ant-api…" : "sk-…"}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              setError(null)
            }}
          />
          {error && (
            <p className="text-xs text-destructive-foreground">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              className={PILL_BUTTON}
              disabled={!apiKey.trim() || save.isPending}
              loading={save.isPending}
            >
              {saved ? "Replace key" : "Save key"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={PILL_BUTTON}
              disabled={save.isPending}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Reveal>
    </div>
  )
}
