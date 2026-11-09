import {
  Alert02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Label } from "@repo/ui/components/label"
import { Radio, RadioGroup } from "@repo/ui/components/radio-group"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { EnvironmentDialog } from "@/components/session/environment-dialog"
import { agentSessionQueryOptions } from "@/hooks/use-agent-session"
import {
  type EnvironmentSummary,
  environmentsQueryOptions,
} from "@/hooks/use-environments"
import { apiClient } from "@/lib/api-client"

// A code session's environment and sandbox size, changed while it runs
// (LOR-156). A new size replaces the sandbox; the server restores the work
// folder from the newest checkpoint.

export type SessionSetupPick = {
  environmentId?: string | null
  sandboxMemoryMb?: number
}

const NONE = "none"

function Choice({
  value,
  selected,
  children,
}: {
  value: string
  selected: boolean
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Radio renders the input
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        selected ? "border-primary" : "border-border"
      )}
    >
      <Radio value={value} />
      {children}
    </label>
  )
}

export function SessionSetupDialog({
  open,
  onOpenChange,
  workspaceSlug,
  session,
  lorRunning = false,
  suggested,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  session: RealtimeAgentSession
  lorRunning?: boolean
  // Lor's suggestion card opens the dialog with its pick.
  suggested?: SessionSetupPick
}) {
  const queryClient = useQueryClient()
  const repo = session.repoFullName
  const { data: list, isPending } = useQuery({
    ...environmentsQueryOptions(workspaceSlug, repo),
    enabled: open && Boolean(repo),
  })
  const environments = list?.environments ?? []
  const defaultMb = list?.defaultSandboxMemoryMb ?? null
  const sizeOf = (environmentId: string | null) =>
    environments.find((env) => env.id === environmentId)?.sandboxMemoryMb ??
    defaultMb
  const currentMb = session.sandboxMemoryMb ?? sizeOf(session.environmentId)

  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  // Null: follow the picked environment's size.
  const [pickedMb, setPickedMb] = useState<number | null>(null)
  const [filled, setFilled] = useState(false)
  if (open && !filled && list) {
    setFilled(true)
    setEnvironmentId(
      suggested?.environmentId !== undefined
        ? suggested.environmentId
        : session.environmentId
    )
    setPickedMb(suggested?.sandboxMemoryMb ?? session.sandboxMemoryMb)
  } else if (!open && filled) {
    setFilled(false)
  }
  const sizeMb = pickedMb ?? sizeOf(environmentId)
  const resizing = filled && sizeMb !== currentMb

  // Kept while the editor closes, so its title doesn't flip mid-animation.
  const [editing, setEditing] = useState<EnvironmentSummary | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const openEditor = (env: EnvironmentSummary | null) => {
    setEditing(env)
    setEditorOpen(true)
  }
  const selected = environments.find((env) => env.id === environmentId) ?? null

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].setup.$patch({
        param: { sessionId: session.id },
        json: {
          environmentId,
          sandboxMemoryMb: pickedMb === sizeOf(environmentId) ? null : pickedMb,
        },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't change the session's setup")
      }
      return res.json()
    },
    onSuccess: ({ session: updated, replaced }) => {
      queryClient.setQueryData(
        agentSessionQueryOptions(session.id).queryKey,
        (detail) => (detail ? { ...detail, session: updated } : detail)
      )
      toast.success(
        replaced
          ? `Replacing the sandbox with a ${(sizeMb ?? 0) / 1024} GB one`
          : "Session setup saved"
      )
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Environment & sandbox</DialogTitle>
            <DialogDescription>
              The env files Lor writes into {repo} and the memory of this
              session's sandbox. Anyone who can write here can change them.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            {isPending ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : !list ? (
              <p className="text-muted-foreground text-sm">
                Couldn't load environments.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Environment</Label>
                  <RadioGroup
                    value={environmentId ?? NONE}
                    onValueChange={(value) =>
                      setEnvironmentId(value === NONE ? null : String(value))
                    }
                    className="flex flex-wrap gap-2"
                  >
                    <Choice value={NONE} selected={environmentId === null}>
                      None
                    </Choice>
                    {environments.map((env) => (
                      <Choice
                        key={env.id}
                        value={env.id}
                        selected={environmentId === env.id}
                      >
                        <span className="max-w-48 truncate">{env.name}</span>
                      </Choice>
                    ))}
                  </RadioGroup>
                  {list.canManage ? (
                    <div className="flex gap-1">
                      {selected && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditor(selected)}
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            strokeWidth={2}
                          />
                          <span className="max-w-40 truncate">
                            Edit {selected.name}
                          </span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditor(null)}
                      >
                        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                        New environment
                      </Button>
                    </div>
                  ) : (
                    environments.length === 0 && (
                      <p className="text-muted-foreground text-xs">
                        No environments for {repo} yet. People who manage
                        environments create them.
                      </p>
                    )
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Sandbox size</Label>
                  <RadioGroup
                    value={String(sizeMb)}
                    onValueChange={(value) => setPickedMb(Number(value))}
                    className="flex flex-wrap gap-2"
                  >
                    {list.sandboxSizes.map((size) => (
                      <Choice
                        key={size.memoryMb}
                        value={String(size.memoryMb)}
                        selected={sizeMb === size.memoryMb}
                      >
                        <span className="font-medium">
                          {size.memoryMb / 1024} GB
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {size.creditsPerHour} credits an hour
                          {size.memoryMb === currentMb && " · current"}
                        </span>
                      </Choice>
                    ))}
                  </RadioGroup>
                </div>
                {resizing && (
                  <div className="flex gap-2 rounded-lg border border-border bg-foreground/[0.02] px-3 py-2 text-[13px] text-muted-foreground">
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="mt-0.5 size-4 shrink-0"
                      strokeWidth={2}
                    />
                    <span>
                      {lorRunning
                        ? "Lor is working in this session. Change the size when its turn ends."
                        : "Saving replaces this session's sandbox. The work folder comes back from Lor's last turn; installed packages, running servers and changes made since then are lost."}
                    </span>
                  </div>
                )}
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={save.isPending}
              disabled={!list || (resizing && lorRunning)}
              onClick={() => save.mutate()}
            >
              {resizing ? "Replace sandbox" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {repo && (
        <EnvironmentDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          workspaceSlug={workspaceSlug}
          repo={repo}
          environment={editing}
          onSaved={(saved) => {
            setEnvironmentId(saved.id)
            // A saved edit to the session's own environment reaches its
            // sandbox now, like the menu's editor did.
            if (saved.id === session.environmentId) {
              void apiClient.v1.sessions[":sessionId"].environment.apply
                .$post({ param: { sessionId: session.id } })
                .catch(() => null)
            }
          }}
        />
      )}
    </>
  )
}
