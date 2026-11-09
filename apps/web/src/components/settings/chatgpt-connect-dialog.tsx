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
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { type ReactNode, useEffect, useState } from "react"
import { useConnectChatgptAccount } from "@/hooks/use-personal-accounts"
import { openExternal } from "@/lib/open-external"

// A sign-in of its own in ~/.codex-lor: Lor refreshes the tokens it is given,
// which would sign the person's own Codex out if it shared them.
const LOGIN_COMMAND =
  "mkdir -p ~/.codex-lor && CODEX_HOME=~/.codex-lor codex -c cli_auth_credentials_store=file login && cat ~/.codex-lor/auth.json"
const INSTALL_DOCS = "https://developers.openai.com/codex/cli"

// Connect a ChatGPT plan for Codex (code-sessions-runbook.md chunk 8f), like
// the Claude subscription: the person signs in with Codex's own login on
// their computer and pastes the auth.json it saves; the server checks it
// first.
export function ChatgptConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const connect = useConnectChatgptAccount()
  const [authJson, setAuthJson] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  // A fresh dialog each time it opens.
  useEffect(() => {
    if (!open) return
    setAuthJson("")
    connect.reset()
  }, [open, connect.reset])

  const submit = () => {
    if (!authJson.trim() || connect.isPending) return
    connect.mutate(authJson, {
      onSuccess: () => {
        toast.success("ChatGPT plan connected")
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
          <DialogTitle>Connect your ChatGPT plan</DialogTitle>
          <DialogDescription>
            Use your own ChatGPT plan for Codex sessions. Only your own messages
            use it; Lor's own agent and your teammates never do.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-6">
          <Step number={1} title="In a terminal on your own computer, run:">
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-5">
                {LOGIN_COMMAND}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? "Copied" : "Copy command"}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(LOGIN_COMMAND)
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
                Codex
              </button>{" "}
              installed. This signs in separately from your own Codex, so Lor
              never signs it out.
            </p>
          </Step>
          <Step
            number={2}
            title="A browser window opens. Sign in with ChatGPT and approve access."
          />
          <Step number={3} title="Paste everything the command prints">
            <Textarea
              autoComplete="off"
              spellCheck={false}
              placeholder='{ "auth_mode": "chatgpt", "tokens": { … } }'
              className="max-h-40 font-mono text-xs"
              value={authJson}
              onChange={(event) => setAuthJson(event.target.value)}
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
            disabled={!authJson.trim()}
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
