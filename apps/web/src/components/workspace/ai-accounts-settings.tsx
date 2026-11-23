import { Button } from "@repo/ui/components/button"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { features } from "@repo/utils/features"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import { AccountLimit } from "@/components/settings/account-limit"
import { ChatgptConnectDialog } from "@/components/settings/chatgpt-connect-dialog"
import { ClaudeConnectDialog } from "@/components/settings/claude-connect-dialog"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import { agentModelsQueryOptions } from "@/hooks/use-agent-models"
import {
  type HarnessAccountsData as Data,
  harnessAccountsEndpoint as endpoint,
  harnessAccountsQueryOptions,
} from "@/hooks/use-harness-accounts"
import { useSettings } from "@/hooks/use-settings"
import { SettingsGroup, SettingsSection } from "./settings-group"

type Settings = NonNullable<Data["settings"]>
type Provider = "claude" | "chatgpt"
const providers = ["claude", "chatgpt"] as const
const names = { claude: "Claude Code", chatgpt: "Codex" }
const enabled = (provider: Provider) =>
  provider === "claude" ? features.claudeCodeHarness : features.codexHarness
const labelFor = (a: Data["accounts"][number]) =>
  a.label ?? a.email ?? `${names[a.provider]} · ${a.login}`

export function AiAccountsSettings({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const client = useQueryClient()
  const key = ["ai-accounts", workspaceSlug]
  const query = useQuery(harnessAccountsQueryOptions(workspaceSlug))
  const { open: openSettings } = useSettings()
  const [connect, setConnect] = useState<Provider | null>(null)
  const models = useQuery(agentModelsQueryOptions("pi", workspaceSlug))
  // Refetch too: a save and a removal can answer out of order with stale lists.
  const changed = (data: Data) => {
    client.setQueryData(key, data)
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({ queryKey: ["agent-models"] })
  }
  const saveSettings = useMutation({
    mutationFn: async (json: Partial<Settings>) => {
      const res = await endpoint.autonomous.$put({
        param: { workspaceSlug },
        json,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't save autonomous settings")
      }
      return res.json()
    },
    onSuccess: changed,
    onError: (err) => toast.error(err.message),
  })
  if (query.isPending)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  if (query.isError)
    return (
      <div className="space-y-3">
        <p>{query.error.message}</p>
        <Button onClick={() => query.refetch()}>Try again</Button>
      </div>
    )
  const data = query.data
  const settings = data.settings
  const update = (patch: Partial<Settings>) => {
    if (settings) saveSettings.mutate(patch)
  }
  const remove = async (provider: Provider, accountId: string) => {
    const res = await endpoint.accounts[":provider"][":accountId"].$delete({
      param: { workspaceSlug, provider, accountId },
    })
    if (!res.ok) {
      toast.error("Couldn't disconnect the account")
      throw new Error("Disconnect failed")
    }
    changed(await res.json())
  }
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Lor’s autonomous runs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure billing and dedicated coding-agent subscriptions for work
          Lor starts on its own.
        </p>
      </div>
      <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">Only for autonomous work</p>
        <p className="text-sm text-muted-foreground">
          Dedicated accounts here belong to Lor and are used only for loops,
          events, and other work it starts on its own. When you ask Lor to do
          something, it uses your personal subscriptions.
        </p>
        <Button
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={() => openSettings("user", "linked-accounts")}
        >
          Manage your subscriptions in user settings
        </Button>
      </div>
      {!data.canManage && (
        <p className="text-sm text-muted-foreground">
          An admin manages Lor’s dedicated subscriptions and autonomous billing.
        </p>
      )}
      {data.canManage && settings && (
        <SettingsSection title="Autonomous agent and billing">
          <p className="mb-4 text-sm text-muted-foreground">
            API billing is the default. To use a coding-agent subscription,
            connect a separate account dedicated to Lor, then enable it below.
          </p>
          <SettingsGroup>
            <div className="space-y-2 py-4">
              <p className="text-sm font-medium">Default agent</p>
              <Choice
                label="Default autonomous agent"
                value={settings.defaultHarness}
                disabled={saveSettings.isPending}
                options={[
                  { value: "pi", label: "Lor" },
                  ...(features.claudeCodeHarness
                    ? [{ value: "claude_code", label: "Claude Code" }]
                    : []),
                  ...(features.codexHarness
                    ? [{ value: "codex", label: "Codex" }]
                    : []),
                ]}
                onChange={(value) =>
                  update({
                    defaultHarness: value as Settings["defaultHarness"],
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Used for background channel work and new autonomous sessions.
              </p>
            </div>
            <div className="space-y-2 py-4">
              <p className="text-sm font-medium">Lor API billing</p>
              <Choice
                label="Lor API model and billing"
                value={settings.apiModel ?? "default"}
                disabled={saveSettings.isPending || models.isPending}
                options={[
                  { value: "default", label: "Default model · Lor credits" },
                  ...(models.data?.models ?? []).map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${m.keyProvider ? `Your ${m.keyProvider === "anthropic" ? "Anthropic" : "OpenAI"} key` : "Lor credits"}`,
                  })),
                ]}
                onChange={(value) =>
                  update({ apiModel: value === "default" ? null : value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Add customer API keys in Workspace settings → Billing.
              </p>
            </div>
            {providers.filter(enabled).map((provider) => {
              const claude = provider === "claude"
              const useSubscriptions = claude
                ? settings.claudeUseSubscriptions
                : settings.codexUseSubscriptions
              const accountId = claude
                ? settings.claudeAccountId
                : settings.codexAccountId
              const autoFallback = claude
                ? settings.claudeAutoFallback
                : settings.codexAutoFallback
              const billing = claude
                ? settings.claudeApiBilling
                : settings.codexApiBilling
              const accounts = data.accounts.filter(
                (a) => a.provider === provider
              )
              return (
                <div key={provider} className="space-y-3 py-4">
                  <ProviderHeading provider={provider}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConnect(provider)}
                    >
                      Connect dedicated subscription
                    </Button>
                  </ProviderHeading>
                  <Choice
                    label={`${names[provider]} autonomous billing`}
                    value={useSubscriptions ? "subscription" : billing}
                    disabled={saveSettings.isPending}
                    options={[
                      { value: "lor", label: "API · Lor credits (default)" },
                      {
                        value: "byok",
                        label: `API · Your ${claude ? "Anthropic" : "OpenAI"} key`,
                      },
                      ...(accounts.length || useSubscriptions
                        ? [
                            {
                              value: "subscription",
                              label:
                                "Subscription dedicated to Lor · autonomous only",
                            },
                          ]
                        : []),
                    ]}
                    onChange={(value) =>
                      update(
                        claude
                          ? {
                              claudeUseSubscriptions: value === "subscription",
                              ...(value === "subscription"
                                ? {
                                    claudeAccountId:
                                      accountId ?? accounts[0]?.id ?? null,
                                  }
                                : {
                                    claudeApiBilling: value as "lor" | "byok",
                                  }),
                            }
                          : {
                              codexUseSubscriptions: value === "subscription",
                              ...(value === "subscription"
                                ? {
                                    codexAccountId:
                                      accountId ?? accounts[0]?.id ?? null,
                                  }
                                : { codexApiBilling: value as "lor" | "byok" }),
                            }
                      )
                    }
                  />
                  {useSubscriptions && (
                    <>
                      <Choice
                        label={`${names[provider]} default Lor account`}
                        value={accountId ?? "missing"}
                        disabled={saveSettings.isPending}
                        options={[
                          ...(!accountId
                            ? [{ value: "missing", label: "Choose an account" }]
                            : []),
                          ...accounts.map((a) => ({
                            value: a.id,
                            label: labelFor(a),
                          })),
                        ]}
                        onChange={(value) => {
                          if (value !== "missing")
                            update(
                              claude
                                ? { claudeAccountId: value }
                                : { codexAccountId: value }
                            )
                        }}
                      />
                      <Fallback
                        checked={autoFallback}
                        disabled={saveSettings.isPending}
                        onChange={(value) =>
                          update(
                            claude
                              ? { claudeAutoFallback: value }
                              : { codexAutoFallback: value }
                          )
                        }
                      />
                    </>
                  )}
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{labelFor(account)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {account.email ?? `Token ending ${account.login}`}
                        </p>
                        <AccountLimit until={account.unavailableUntil} />
                      </div>
                      <InlineConfirmButton
                        label={`Disconnect ${labelFor(account)}`}
                        confirmLabel="Disconnect"
                        onConfirm={() => remove(provider, account.id)}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          </SettingsGroup>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Only connect subscriptions dedicated to Lor and permitted for this
            use by the provider. Buying a separate subscription does not change
            the provider's terms. If every linked account reaches its limit, Lor
            stops; it does not silently switch billing sources.
          </p>
        </SettingsSection>
      )}
      <ClaudeConnectDialog
        open={connect === "claude"}
        onOpenChange={(open) => {
          if (!open) setConnect(null)
        }}
        workspaceSlug={workspaceSlug}
      />
      <ChatgptConnectDialog
        open={connect === "chatgpt"}
        onOpenChange={(open) => {
          if (!open) setConnect(null)
        }}
        workspaceSlug={workspaceSlug}
      />
    </div>
  )
}

function ProviderHeading({
  provider,
  children,
}: {
  provider: Provider
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <HarnessLogo
        harness={provider === "claude" ? "claude_code" : "codex"}
        className="size-4"
      />
      <p className="flex-1 text-sm font-medium">{names[provider]}</p>
      {children}
    </div>
  )
}
function Fallback({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">
        When usage runs out, try the next account of this provider.
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label="Automatically use the next account"
      />
    </label>
  )
}
function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}
