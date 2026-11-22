import { Button } from "@repo/ui/components/button"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { Separator } from "@repo/ui/components/separator"
import { Spinner } from "@repo/ui/components/spinner"
import { formatDate } from "@repo/utils/date"
import { features } from "@repo/utils/features"
import { useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import { ChatgptConnectDialog } from "@/components/settings/chatgpt-connect-dialog"
import { ClaudeConnectDialog } from "@/components/settings/claude-connect-dialog"
import {
  useConnectGithubAccount,
  useDisconnectChatgptAccount,
  useDisconnectClaudeAccount,
  useDisconnectGithubAccount,
  usePersonalAccounts,
} from "@/hooks/use-personal-accounts"

// The person's own accounts. Workspace-wide connections are Connectors in
// workspace settings; these are never shared.
export function LinkedAccountsSettings() {
  const { data, isPending, isError, refetch } = usePersonalAccounts()
  const connect = useConnectGithubAccount()
  const disconnect = useDisconnectGithubAccount()
  const disconnectClaude = useDisconnectClaudeAccount()
  const [connectingClaude, setConnectingClaude] = useState(false)
  const disconnectChatgpt = useDisconnectChatgptAccount()
  const [connectingChatgpt, setConnectingChatgpt] = useState(false)

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load your linked accounts.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const { available, account } = data.github
  const { claude, chatgpt } = data
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Linked accounts</h3>
        <p className="text-sm text-muted-foreground">
          Link multiple accounts for the turns you start. Choose defaults and
          automatic fallback for each workspace in Workspace settings → AI
          accounts.
        </p>
      </div>

      <Separator />

      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
          <GitHubLogo className="size-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">GitHub</p>
          <p className="truncate text-muted-foreground text-xs">
            {account
              ? `Connected as @${account.login}${account.email ? ` · ${account.email}` : ""}`
              : available
                ? "Commit and push as yourself in code sessions."
                : "Not available on this server yet."}
          </p>
        </div>
        {account ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!available || connect.isPending}
            onClick={() => connect.mutate()}
          >
            Connect
          </Button>
        )}
      </div>

      {(features.claudeCodeHarness || claude.accounts.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <HarnessLogo harness="claude_code" className="size-5" />
            <h4 className="flex-1 text-sm font-medium">Claude Code</h4>
            <Button
              size="sm"
              variant="outline"
              disabled={!claude.available}
              onClick={() => setConnectingClaude(true)}
            >
              Add account
            </Button>
          </div>
          {claude.accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No Claude accounts connected.
            </p>
          )}
          {claude.accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {account.label ?? `Claude · ${account.tokenHint}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Token ending {account.tokenHint} · Connected{" "}
                  {formatDate(account.connectedAt)}
                </p>
                <AccountLimit until={account.unavailableUntil} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnectClaude.isPending}
                onClick={() => disconnectClaude.mutate(account.id)}
              >
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
      {features.claudeCodeHarness && (
        <ClaudeConnectDialog
          open={connectingClaude}
          onOpenChange={setConnectingClaude}
        />
      )}

      {(features.codexHarness || chatgpt.accounts.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <HarnessLogo harness="codex" className="size-5" />
            <h4 className="flex-1 text-sm font-medium">Codex</h4>
            <Button
              size="sm"
              variant="outline"
              disabled={!chatgpt.available}
              onClick={() => setConnectingChatgpt(true)}
            >
              Add account
            </Button>
          </div>
          {chatgpt.accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No Codex accounts connected.
            </p>
          )}
          {chatgpt.accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {account.label ?? account.email ?? "ChatGPT account"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[account.email, account.plan && planName(account.plan)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <AccountLimit until={account.unavailableUntil} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnectChatgpt.isPending}
                onClick={() => disconnectChatgpt.mutate(account.id)}
              >
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
      {features.codexHarness && (
        <ChatgptConnectDialog
          open={connectingChatgpt}
          onOpenChange={setConnectingChatgpt}
        />
      )}
    </div>
  )
}

// The token's plan claim ("plus", "pro") as ChatGPT names it.
function planName(plan: string) {
  return `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`
}

export function AccountLimit({ until }: { until: string | null }) {
  if (!until || new Date(until).getTime() <= Date.now()) return null
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Usage limit reached · Retry after {new Date(until).toLocaleString()}
    </p>
  )
}
