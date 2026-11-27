import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { formatDateTime } from "@repo/utils/date"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { SettingsSection } from "@/components/workspace/settings-group"
import { apiClient } from "@/lib/api-client"
import { integrationsQueryOptions } from "@/lib/integrations-query"

// Circleback's webhook can't be registered through its API: people add a
// "Send webhook request" step to an automation themselves, with this URL,
// and paste back the step's signing secret. reference/circleback-connector.md.

const CIRCLEBACK_AUTOMATIONS_URL = "https://circleback.ai/automations"

const STEP = "flex gap-3 py-3"
const STEP_NUMBER =
  "flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-medium tabular-nums"

export function CirclebackWebhookSetup({
  workspaceSlug,
  webhook,
}: {
  workspaceSlug: string
  webhook: { url: string; secretSet: boolean; receivedAt: string | null }
}) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [secret, setSecret] = useState("")
  const [editing, setEditing] = useState(!webhook.secretSet)
  // Polls the connectors list while waiting for Circleback's test request,
  // so the status flips to received without a reload.
  useQuery({
    ...integrationsQueryOptions(workspaceSlug),
    refetchInterval: webhook.secretSet && !webhook.receivedAt ? 5000 : false,
  })

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.circleback["webhook-secret"].$put({
        param: { workspaceSlug },
        json: { secret: secret.trim() },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't save the secret")
      }
    },
    onSuccess: async () => {
      setSecret("")
      setEditing(false)
      await queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Signing secret saved")
    },
    onError: (error) => toast.error(error.message),
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhook.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy the URL")
    }
  }

  const status = webhook.receivedAt
    ? `Last meeting received ${formatDateTime(webhook.receivedAt)}`
    : webhook.secretSet
      ? "Waiting for the first meeting"
      : "Not set up yet"

  return (
    <SettingsSection
      title="New meetings"
      action={
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {webhook.receivedAt && (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-success"
            />
          )}
          {status}
        </span>
      }
      description="Circleback sends each new meeting to Lor from an automation, on Pro plans and up. Set it up once:"
    >
      <ol className="divide-y divide-border rounded-xl bg-muted px-4 dark:bg-muted/60">
        <li className={STEP}>
          <span className={STEP_NUMBER}>1</span>
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p>
              In{" "}
              <a
                href={CIRCLEBACK_AUTOMATIONS_URL}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Circleback's automations
              </a>
              , make one with a <strong>Send webhook request</strong> step to
              this URL:
            </p>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Lor's webhook URL"
                readOnly
                size="sm"
                value={webhook.url}
                className="min-w-0 flex-1 font-mono text-xs sm:text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={copy}
              >
                <HugeiconsIcon
                  icon={copied ? Tick02Icon : Copy01Icon}
                  className="size-3.5"
                  strokeWidth={2}
                />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A Circleback admin can share it with the workspace and turn on
              “Enable this automation for people added”, so everyone's meetings
              come through. Its conditions decide which meetings Lor gets, for
              example leaving out ones tagged 1:1.
            </p>
          </div>
        </li>
        <li className={STEP}>
          <span className={STEP_NUMBER}>2</span>
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p>Paste the signing secret Circleback shows for that step.</p>
            {editing ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (secret.trim()) save.mutate()
                }}
              >
                <Input
                  aria-label="Signing secret"
                  type="password"
                  autoComplete="off"
                  size="sm"
                  value={secret}
                  disabled={save.isPending}
                  onChange={(e) => setSecret(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="shrink-0"
                  disabled={!secret.trim() || save.isPending}
                >
                  {save.isPending && <Spinner className="size-3.5" />}Save
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Saved</span>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="cursor-pointer font-medium text-foreground hover:underline"
                >
                  Replace
                </button>
              </div>
            )}
          </div>
        </li>
        <li className={STEP}>
          <span className={STEP_NUMBER}>3</span>
          <p className="min-w-0 flex-1 text-sm">
            Press <strong>Send test request</strong> in Circleback. The status
            above changes when Lor receives it.
          </p>
        </li>
      </ol>
    </SettingsSection>
  )
}
