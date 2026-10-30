import {
  PencilEdit02Icon,
  PlusSignIcon,
  Settings02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { useState } from "react"
import { EnvironmentDialog } from "@/components/session/environment-dialog"
import type { CodeEnvironmentState } from "@/hooks/use-environments"

// At the far right of the New session view's repo row: which environment's
// env files the code session writes (reference/dev-environment-runbook.md
// §2). Lists the environments that include the picked repo.
export function EnvironmentPicker({
  workspaceSlug,
  repo,
  environment,
}: {
  workspaceSlug: string
  repo: string
  environment: CodeEnvironmentState
}) {
  const { environments, selected, canManage } = environment
  // Kept while the dialog closes, so its title doesn't flip mid-animation.
  const [editing, setEditing] = useState<typeof selected>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openDialog = (env: typeof selected) => {
    setEditing(env)
    setDialogOpen(true)
  }
  // Wrapped: the menu item's own svg margins would override ml-auto.
  const check = (on: boolean) =>
    on ? (
      <span className="ml-auto flex">
        <HugeiconsIcon icon={Tick02Icon} className="size-4" />
      </span>
    ) : null
  const footer = environment.failed ? (
    <DropdownMenuItem onClick={environment.retry}>
      Couldn't load environments. Retry
    </DropdownMenuItem>
  ) : environment.loading ? (
    <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
  ) : canManage ? (
    <>
      {selected && (
        <DropdownMenuItem onClick={() => openDialog(selected)}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
          <span className="min-w-0 truncate">Edit {selected.name}</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => openDialog(null)}>
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        New environment
      </DropdownMenuItem>
    </>
  ) : (
    <DropdownMenuItem disabled>Admins create environments</DropdownMenuItem>
  )

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          title={
            selected ? `Environment: ${selected.name}` : "Environment settings"
          }
          className="ml-auto inline-flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
        >
          <HugeiconsIcon
            icon={Settings02Icon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
          {selected && (
            <span className="max-w-40 truncate">{selected.name}</span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Environment</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => environment.select(null)}>
              None
              {check(!selected)}
            </DropdownMenuItem>
            {environments.map((env) => (
              <DropdownMenuItem
                key={env.id}
                onClick={() => environment.select(env.id)}
              >
                <span className="min-w-0 truncate">{env.name}</span>
                {check(selected?.id === env.id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {footer}
        </DropdownMenuContent>
      </DropdownMenu>
      <EnvironmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceSlug={workspaceSlug}
        repo={repo}
        environment={editing}
        onSaved={(saved) => environment.select(saved.id)}
      />
    </>
  )
}
