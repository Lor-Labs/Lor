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
          Your own accounts. Lor uses them only when you act, never for your
          teammates.
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

      {(features.claudeCodeHarness || claude.account) && (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <HarnessLogo harness="claude_code" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">Claude subscription</p>
            <p className="truncate text-muted-foreground text-xs">
              {claude.account
                ? `Token ending in ${claude.account.tokenHint} · connected ${formatDate(claude.account.connectedAt)}`
                : claude.available
                  ? "Run Claude Code sessions on your own Claude Pro or Max plan."
                  : "Not available on this server yet."}
            </p>
          </div>
          {claude.account ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disconnectClaude.isPending}
              onClick={() => disconnectClaude.mutate()}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!claude.available}
              onClick={() => setConnectingClaude(true)}
            >
              Connect
            </Button>
          )}
        </div>
      )}
      {features.claudeCodeHarness && (
        <ClaudeConnectDialog
          open={connectingClaude}
          onOpenChange={setConnectingClaude}
        />
      )}

      {(features.codexHarness || chatgpt.account) && (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <HarnessLogo harness="codex" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">ChatGPT plan</p>
            <p className="truncate text-muted-foreground text-xs">
              {chatgpt.account
                ? [
                    chatgpt.account.email ?? "Connected",
                    chatgpt.account.plan && planName(chatgpt.account.plan),
                    `connected ${formatDate(chatgpt.account.connectedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : chatgpt.available
                  ? "Run Codex sessions on your own ChatGPT plan."
                  : "Not available on this server yet."}
            </p>
          </div>
          {chatgpt.account ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disconnectChatgpt.isPending}
              onClick={() => disconnectChatgpt.mutate()}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!chatgpt.available}
              onClick={() => setConnectingChatgpt(true)}
            >
              Connect
            </Button>
          )}
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
