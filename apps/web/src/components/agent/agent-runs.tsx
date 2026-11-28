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
import { cn } from "@repo/ui/lib/utils"
import { features } from "@repo/utils/features"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import { AccountLimit } from "@/components/settings/account-limit"
import { ChatgptConnectDialog } from "@/components/settings/chatgpt-connect-dialog"
import { ClaudeConnectDialog } from "@/components/settings/claude-connect-dialog"
import { AgentModelSelect } from "@/components/sidebar/channel-panel/agent-model-select"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import {
  SETTINGS_SURFACE,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { agentsKey, type WorkspaceAgent } from "@/hooks/use-agents"
import {
  type HarnessAccountsData as Data,
  harnessAccountsEndpoint as endpoint,
  harnessAccountsQueryOptions,
} from "@/hooks/use-harness-accounts"
import { saveAgent } from "@/lib/agent-api"

type Settings = NonNullable<Data["settings"]>
// A saved "pi" still reads back; only Claude Code or Codex can be saved.
type SettingsPatch = Partial<Omit<Settings, "defaultHarness">> & {
  defaultHarness?: "claude_code" | "codex"
}
type Provider = "claude" | "chatgpt"
const providers = ["claude", "chatgpt"] as const
const names = { claude: "Claude Code", chatgpt: "Codex" }
const enabled = (provider: Provider) =>
  provider === "claude" ? features.claudeCodeHarness : features.codexHarness
const labelFor = (a: Data["accounts"][number]) =>
  a.label ?? a.email ?? `${names[a.provider]} · ${a.login}`

// How an agent runs and who pays (reference/agents-and-chats.md, decision
// 7): its model, for its own turns (Lor credits or a provider key, never a
// subscription), and what the code sessions it starts on its own run on,
// with the workspace accounts they may use. A person's own plan pays for a
// session they ask for. Each change saves at once.
export function AgentRuns({
  workspaceSlug,
  agent,
  canManage,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
  // channel:update, for the model. Billing choices take billing:manage,
  // which the server reports with the settings.
  canManage: boolean
}) {
  const client = useQueryClient()
  const options = harnessAccountsQueryOptions(workspaceSlug, agent.id)
  const key = options.queryKey
  const query = useQuery(options)
  const [connect, setConnect] = useState<Provider | null>(null)
  // Kept after close so the dialog's text doesn't change while it fades out.
  const [replacing, setReplacing] = useState<{
    accountId: string
    name: string
  } | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  // Refetch too: a save and a removal can answer out of order with stale lists.
  const changed = (data: Data) => {
    client.setQueryData(key, data)
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({ queryKey: ["agent-models"] })
  }
  const saveSettings = useMutation({
    mutationFn: async (json: SettingsPatch) => {
      const res = await endpoint.autonomous.$put({
        param: { workspaceSlug },
        query: { agentId: agent.id },
        json,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't save how it runs")
      }
      return res.json()
    },
    onSuccess: changed,
    onError: (err) => toast.error(err.message),
  })
  const saveModel = useMutation({
    mutationFn: (model: string | null) =>
      saveAgent(workspaceSlug, agent.id, { model }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentsKey(workspaceSlug) })
      void client.invalidateQueries({ queryKey: key })
    },
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
  const update = (patch: SettingsPatch) => {
    if (settings) saveSettings.mutate(patch)
  }
  const remove = async (provider: Provider, accountId: string) => {
    const res = await endpoint.accounts[":provider"][":accountId"].$delete({
      param: { workspaceSlug, provider, accountId },
      query: { agentId: agent.id },
    })
    if (!res.ok) {
      toast.error("Couldn't disconnect the account")
      throw new Error("Disconnect failed")
    }
    changed(await res.json())
  }
  return (
    <div className="space-y-6">
      <SettingsSection
        title="Model"
        caption={`What ${agent.name} thinks with in its own turns, paid by Lor credits, or by your own API key when the model is one it pays for.`}
      >
        <div className={cn(SETTINGS_SURFACE, "p-4")}>
          <AgentModelSelect
            workspaceSlug={workspaceSlug}
            value={agent.model}
            disabled={!canManage || saveModel.isPending}
            onChange={(model) => saveModel.mutate(model)}
          />
        </div>
      </SettingsSection>
      {!data.canManage && (
        <p className="px-4 text-muted-foreground text-sm">
          An admin sets what {agent.name}'s code sessions run on and which
          accounts pay.
        </p>
      )}
      {data.canManage && settings && (
        <SettingsSection
          title="Code sessions"
          description={`When someone asks ${agent.name} for code work, the session runs on their own Claude or ChatGPT plan. These settings cover the sessions ${agent.name} starts with nobody asking, and people with no plan linked; with no subscription or workspace key set below, they run on Lor credits.`}
        >
          <SettingsGroup>
            <div className="space-y-2 py-4">
              <p className="text-sm font-medium">Coding agent</p>
              <Choice
                label="Coding agent"
                value={
                  settings.defaultHarness === "pi"
                    ? "claude_code"
                    : settings.defaultHarness
                }
                disabled={saveSettings.isPending}
                options={[
                  ...(features.claudeCodeHarness
                    ? [{ value: "claude_code", label: "Claude Code" }]
                    : []),
                  ...(features.codexHarness
                    ? [{ value: "codex", label: "Codex" }]
                    : []),
                ]}
                onChange={(value) =>
                  update({
                    defaultHarness: value as "claude_code" | "codex",
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                The default for the code sessions it starts; it can pick another
                per session.
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
                      Connect an account
                    </Button>
                  </ProviderHeading>
                  <Choice
                    label={`${names[provider]} billing`}
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
                              label: "A subscription connected for agents",
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
                        label={`${names[provider]} account`}
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
                      {claude && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Replace token for ${labelFor(account)}`}
                          onClick={() => {
                            setReplacing({
                              accountId: account.id,
                              name: labelFor(account),
                            })
                            setReplaceOpen(true)
                          }}
                        >
                          Replace token
                        </Button>
                      )}
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
          <p className="px-4 text-xs leading-relaxed text-muted-foreground">
            Accounts connected here belong to the workspace, and any agent can
            be set to use them. Only connect subscriptions the provider permits
            for this use: buying a separate one does not change its terms. If
            every account reaches its limit, {agent.name} stops; it does not
            silently switch billing sources.
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
      <ClaudeConnectDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        workspaceSlug={workspaceSlug}
        replace={replacing ?? undefined}
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
