import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { toast } from "@repo/ui/components/toast"
import { type ReactNode, useEffect, useState } from "react"
import { useConnectClaudeAccount } from "@/hooks/use-personal-accounts"
import { openExternal } from "@/lib/open-external"

const SETUP_COMMAND = "claude setup-token"
const INSTALL_DOCS = "https://code.claude.com/docs/en/setup"

// Connect a Claude subscription (code-sessions-runbook.md chunk 7), like
// Amp's: the person makes a long-lived token on their own computer with
// Anthropic's sign-in and pastes it here; the server checks it first.
export function ClaudeConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const connect = useConnectClaudeAccount()
  const [token, setToken] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  // A fresh dialog each time it opens.
  useEffect(() => {
    if (!open) return
    setToken("")
    connect.reset()
  }, [open, connect.reset])

  const submit = () => {
    if (!token.trim() || connect.isPending) return
    connect.mutate(token, {
      onSuccess: () => {
        toast.success("Claude subscription connected")
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!connect.isPending) onOpenChange(next)
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect your Claude subscription</DialogTitle>
          <DialogDescription>
            Use your own Claude Pro or Max plan for Claude Code sessions. Only
            your own messages use it; Lor's own agent and your teammates never
            do.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-6">
          <Step number={1} title="In a terminal on your own computer, run:">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-sm">
                {SETUP_COMMAND}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? "Copied" : "Copy command"}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(SETUP_COMMAND)
                    .then(() => setCopied(true))
                    .catch(() => {})
                }}
              >
                <HugeiconsIcon
                  icon={copied ? Tick02Icon : Copy01Icon}
                  className="size-4"
                />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              You need{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                onClick={() => openExternal(INSTALL_DOCS)}
              >
                Claude Code
              </button>{" "}
              installed.
            </p>
          </Step>
          <Step
            number={2}
            title="A browser window opens. Sign in with your Claude Pro or Max account and approve access."
          />
          <Step number={3} title="Paste the token the command prints">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-oat01-…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit()
              }}
              aria-invalid={connect.isError || undefined}
            />
            {connect.isError && (
              <p className="text-destructive text-xs">
                {connect.error.message}
              </p>
            )}
          </Step>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={connect.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            loading={connect.isPending}
            disabled={!token.trim()}
            onClick={submit}
          >
            Verify & connect
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground font-semibold text-background text-xs">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm leading-6">{title}</p>
        {children}
      </div>
    </div>
  )
}
