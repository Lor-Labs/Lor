import { ArrowRight01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import {
  formatWorkspaceRole,
  type roles as staticRoles,
  workspaceStatementMeta,
  workspaceStatements,
} from "@repo/auth/permissions"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PILL_BUTTON,
  SETTINGS_SURFACE,
  SettingsBackButton,
  SettingsCard,
  SettingsCardButton,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  useWorkspaceRoles,
  type WorkspaceCustomRole,
  workspaceRolesQueryKey,
} from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"

const MATRIX_RESOURCES = Object.keys(
  workspaceStatements
) as (keyof typeof workspaceStatements)[]

const STATIC_ROLE_SUMMARIES: {
  role: keyof typeof staticRoles
  blurb: string
}[] = [
  { role: "owner", blurb: "Full access to everything, cannot be assigned" },
  { role: "admin", blurb: "Every permission, can manage roles" },
  { role: "member", blurb: "Base access: read, post, and react" },
]

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; role: WorkspaceCustomRole }
  | null

function grantKey(resource: string, action: string) {
  return `${resource}:${action}`
}

function grantsToKeys(grants: WorkspaceCustomRole["grants"]): Set<string> {
  const keys = new Set<string>()
  for (const [resource, actions] of Object.entries(grants ?? {})) {
    for (const action of actions) keys.add(grantKey(resource, action))
  }
  return keys
}

function keysToPermission(keys: Set<string>): Record<string, string[]> {
  const permission: Record<string, string[]> = {}
  for (const key of keys) {
    const [resource, ...rest] = key.split(":")
    if (!resource) continue
    const action = rest.join(":")
    permission[resource] = [...(permission[resource] ?? []), action]
  }
  return permission
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

function RoleEditor({
  editor,
  workspaceId,
  onClose,
  onDelete,
}: {
  editor: NonNullable<EditorState>
  workspaceId: string
  onClose: () => void
  onDelete?: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(
    editor.mode === "edit" ? editor.role.role : ""
  )
  const [selected, setSelected] = useState<Set<string>>(() =>
    editor.mode === "edit" ? grantsToKeys(editor.role.grants) : new Set()
  )

  const toggle = (key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const permission = keysToPermission(selected)
      const res =
        editor.mode === "create"
          ? await authClient.organization.createRole({
              organizationId: workspaceId,
              role: name.trim(),
              permission,
              additionalFields: {},
            })
          : await authClient.organization.updateRole({
              organizationId: workspaceId,
              roleName: editor.role.role,
              data: { permission },
            })
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to save role")
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceRolesQueryKey(workspaceId),
      })
      toast.success(editor.mode === "create" ? "Role created" : "Role updated")
      onClose()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save role"
      )
    },
  })

  // Editing may clear every grant (a grantless role is member-tier access);
  // creating an empty role is almost certainly a mistake, so require one.
  const canSave =
    editor.mode === "edit" ? true : name.trim().length > 0 && selected.size > 0

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SettingsBackButton label="All roles" onClick={onClose} />
        <div className="space-y-2">
          {editor.mode === "create" ? (
            <Input
              size="lg"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Role name, e.g. support"
              aria-label="Role name"
              maxLength={64}
            />
          ) : (
            <h2 className="text-lg font-semibold">
              {formatWorkspaceRole(editor.role.role)}
            </h2>
          )}
          <p className="text-sm text-muted-foreground">
            People with this role get member access, plus the permissions you
            pick here.
          </p>
        </div>
      </div>

      <SettingsSection
        title="Permissions"
        action={
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
        }
      >
        <SettingsGroup>
          {MATRIX_RESOURCES.map((resource) => {
            const meta = workspaceStatementMeta[resource]
            return (
              <div
                key={resource}
                className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 py-3"
              >
                <span className="text-sm font-medium">{meta.label}</span>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {workspaceStatements[resource].map((action) => {
                    const key = grantKey(resource, action)
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox
                          id={`grant-${key}`}
                          checked={selected.has(key)}
                          onCheckedChange={(checked) =>
                            toggle(key, checked === true)
                          }
                        />
                        <Label
                          htmlFor={`grant-${key}`}
                          className="cursor-pointer text-sm font-normal"
                        >
                          {(meta.actions as Record<string, string>)[action] ??
                            action}
                        </Label>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </SettingsGroup>
      </SettingsSection>

      <div className="flex items-center gap-2">
        {onDelete && (
          <Button
            variant="destructive-outline"
            className={PILL_BUTTON}
            disabled={saveMutation.isPending}
            onClick={onDelete}
          >
            Delete role
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            className={PILL_BUTTON}
            disabled={saveMutation.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className={PILL_BUTTON}
            loading={saveMutation.isPending}
            disabled={!canSave}
            onClick={() => saveMutation.mutate()}
          >
            {editor.mode === "create" ? "Create role" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function RolesSection({
  workspaceId,
  workspaceSlug,
  onViewChange,
}: {
  workspaceId: string
  workspaceSlug: string
  // Scrolls the Members & Roles tab back to its top when the list and the
  // editor swap.
  onViewChange: () => void
}) {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState>(null)
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceCustomRole | null>(
    null
  )
  const listRef = useRef<HTMLDivElement>(null)

  const { data: customRoles, isPending } = useWorkspaceRoles(workspaceId)

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })

  const memberCountByRole = useMemo(() => {
    const counts = new Map<string, number>()
    for (const member of membersData?.members ?? []) {
      counts.set(member.role, (counts.get(member.role) ?? 0) + 1)
    }
    return counts
  }, [membersData])

  const deleteMutation = useMutation({
    mutationFn: async (roleName: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].roles[
        ":roleName"
      ].$delete({
        param: { workspaceSlug, roleName },
      })
      if (!res.ok) throw new Error("Failed to delete role")
      return res.json()
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceRolesQueryKey(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-members", workspaceSlug],
        }),
      ])
      setDeleteTarget(null)
      setEditor(null)
      toast.success("Role deleted")
    },
    onError: () => {
      toast.error("Failed to delete role")
    },
  })

  let editorKey = "list"
  if (editor) editorKey = editor.mode === "edit" ? editor.role.id : "create"

  useLayoutEffect(() => {
    onViewChange()
  }, [editorKey])

  // Back from the editor: return focus to the card that opened it.
  useEffect(() => {
    if (editor || !returnFocusId) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-role="${returnFocusId}"]`)
      ?.focus({ preventScroll: true })
  }, [editor])

  const openEditor = (next: NonNullable<EditorState>) => {
    setReturnFocusId(next.mode === "edit" ? next.role.id : "new")
    setEditor(next)
  }

  const deleteTargetMemberCount = deleteTarget
    ? (memberCountByRole.get(deleteTarget.role) ?? 0)
    : 0

  const roles = customRoles ?? []
  let customRolesBody: ReactNode = null
  if (!isPending && roles.length === 0) {
    customRolesBody = (
      <SettingsCard>
        <p className="text-sm text-muted-foreground">
          No custom roles yet. Create one to grant specific permissions.
        </p>
      </SettingsCard>
    )
  } else if (!isPending) {
    customRolesBody = (
      <div className="space-y-2">
        {roles.map((role) => (
          <SettingsCardButton
            key={role.id}
            data-role={role.id}
            onClick={() => openEditor({ mode: "edit", role })}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {formatWorkspaceRole(role.role)}
              </span>
              <span className="block text-sm text-muted-foreground">
                {plural(grantsToKeys(role.grants).size, "permission")} ·{" "}
                {plural(memberCountByRole.get(role.role) ?? 0, "member")}
              </span>
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
          </SettingsCardButton>
        ))}
      </div>
    )
  }

  return (
    <div ref={listRef}>
      {editor ? (
        <RoleEditor
          key={editorKey}
          editor={editor}
          workspaceId={workspaceId}
          onClose={() => setEditor(null)}
          onDelete={
            editor.mode === "edit"
              ? () => setDeleteTarget(editor.role)
              : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          <SettingsSection
            title="Built-in roles"
            count={STATIC_ROLE_SUMMARIES.length}
          >
            <div className="space-y-2">
              {STATIC_ROLE_SUMMARIES.map(({ role, blurb }) => (
                <div
                  key={role}
                  className={cn(
                    SETTINGS_SURFACE,
                    "flex items-center gap-3 p-3"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {formatWorkspaceRole(role)}
                    </div>
                    <div className="text-sm text-muted-foreground">{blurb}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {plural(memberCountByRole.get(role) ?? 0, "member")}
                  </span>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Custom roles"
            count={isPending ? undefined : roles.length}
            action={
              <Button
                variant="secondary"
                size="sm"
                className={cn(PILL_BUTTON, "px-3")}
                data-role="new"
                onClick={() => openEditor({ mode: "create" })}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                New role
              </Button>
            }
            caption="Assign roles to people in the Members tab."
          >
            {customRolesBody}
          </SettingsSection>
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? deleteTargetMemberCount > 0
                  ? `Delete ${formatWorkspaceRole(deleteTarget.role)}? ${deleteTargetMemberCount} ${deleteTargetMemberCount === 1 ? "member" : "members"} holding it will become Member.`
                  : `Delete ${formatWorkspaceRole(deleteTarget.role)}? This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.role)
              }}
            >
              Delete role
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
