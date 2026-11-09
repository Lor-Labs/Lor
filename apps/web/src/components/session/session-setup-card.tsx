import { Settings02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { SessionSetupDialog } from "@/components/session/session-setup-dialog"
import { agentSessionQueryOptions } from "@/hooks/use-agent-session"
import { environmentsQueryOptions } from "@/hooks/use-environments"
import type { LorToolCallView } from "@/lib/api-types"

type Suggestion = NonNullable<LorToolCallView["setup"]>

// Lor's suggest_session_setup result (LOR-156): Apply opens the session's
// Environment & sandbox dialog with the suggestion picked, so a new size's
// warning shows before the sandbox is replaced.
export function SessionSetupCard({ setup }: { setup: Suggestion }) {
  const { workspaceSlug } = useParams({ strict: false })
  const { data } = useQuery(agentSessionQueryOptions(setup.sessionId))
  const session = data?.session
  const { data: list } = useQuery(
    environmentsQueryOptions(
      workspaceSlug ?? "",
      workspaceSlug ? (session?.repoFullName ?? null) : null
    )
  )
  const [open, setOpen] = useState(false)

  const environmentMb = list?.environments.find(
    (env) => env.id === session?.environmentId
  )?.sandboxMemoryMb
  const currentMb =
    session?.sandboxMemoryMb ??
    environmentMb ??
    list?.defaultSandboxMemoryMb ??
    null
  const applied =
    session !== undefined &&
    (setup.environmentId === undefined ||
      setup.environmentId === session.environmentId) &&
    (setup.sandboxMemoryMb === undefined || setup.sandboxMemoryMb === currentMb)

  const title = [
    setup.sandboxMemoryMb !== undefined &&
      `${setup.sandboxMemoryMb / 1024} GB sandbox`,
    setup.environmentName && `the ${setup.environmentName} environment`,
  ]
    .filter(Boolean)
    .join(" and ")

  return (
    <div className="mt-2 flex w-full max-w-md items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <HugeiconsIcon
        icon={Settings02Icon}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">Switch to {title}</p>
        <p className="text-[13px] text-muted-foreground">{setup.reason}</p>
      </div>
      {applied ? (
        <span className="shrink-0 self-center text-muted-foreground text-xs">
          Applied
        </span>
      ) : session && workspaceSlug && !session.archivedAt ? (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-center"
          onClick={() => setOpen(true)}
        >
          Review
        </Button>
      ) : null}
      {session && workspaceSlug && (
        <SessionSetupDialog
          open={open}
          onOpenChange={setOpen}
          workspaceSlug={workspaceSlug}
          session={session}
          suggested={{
            ...(setup.environmentId !== undefined
              ? { environmentId: setup.environmentId }
              : {}),
            ...(setup.sandboxMemoryMb !== undefined
              ? { sandboxMemoryMb: setup.sandboxMemoryMb }
              : {}),
          }}
        />
      )}
    </div>
  )
}
