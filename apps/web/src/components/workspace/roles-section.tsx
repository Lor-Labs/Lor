import { Add01Icon } from "@hugeicons/core-free-icons"
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
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
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

function RoleEditor({
  editor,
  workspaceId,
  onClose,
}: {
  editor: NonNullable<EditorState>
  workspaceId: string
  onClose: () => void
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

  const canSave =
    (editor.mode === "edit" || name.trim().length > 0) && selected.size > 0

  return (
    <div className="space-y-4 rounded-lg border border-border/60 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">
          {editor.mode === "create"
            ? "New role"
            : `Edit ${formatWorkspaceRole(editor.role.role)}`}
        </h4>
      </div>

      {editor.mode === "create" && (
        <div className="space-y-1.5">
          <Label htmlFor="role-name">Role name</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. support"
            maxLength={64}
          />
        </div>
      )}

      <div className="space-y-4">
        {MATRIX_RESOURCES.map((resource) => {
          const meta = workspaceStatementMeta[resource]
          return (
            <fieldset key={resource} className="space-y-1.5">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {meta.label}
              </legend>
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
                      className="text-sm font-normal"
                    >
                      {(meta.actions as Record<string, string>)[action] ??
                        action}
                    </Label>
                  </div>
                )
              })}
            </fieldset>
          )
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          loading={saveMutation.isPending}
          disabled={!canSave}
          onClick={() => saveMutation.mutate()}
        >
          {editor.mode === "create" ? "Create role" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}

export function RolesSection({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceCustomRole | null>(
    null
  )

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
      toast.success("Role deleted")
    },
    onError: () => {
      toast.error("Failed to delete role")
    },
  })

  const deleteTargetMemberCount = deleteTarget
    ? (memberCountByRole.get(deleteTarget.role) ?? 0)
    : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Roles</h3>
          <p className="text-xs text-muted-foreground">
            Custom roles grant specific permissions to members
          </p>
        </div>
        {!editor && (
          <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
            <HugeiconsIcon
              icon={Add01Icon}
              className="size-4"
              strokeWidth={2}
            />
            New role
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {STATIC_ROLE_SUMMARIES.map(({ role, blurb }) => (
          <div
            key={role}
            className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {formatWorkspaceRole(role)}
                <Badge variant="secondary" className="text-[10px]">
                  Built-in
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{blurb}</div>
            </div>
            <span className="text-xs text-muted-foreground">
              {memberCountByRole.get(role) ?? 0} members
            </span>
          </div>
        ))}

        {isPending
          ? null
          : (customRoles ?? []).map((role) => {
              const grantCount = grantsToKeys(role.grants).size
              return (
                <div
                  key={role.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {formatWorkspaceRole(role.role)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {grantCount}{" "}
                      {grantCount === 1 ? "permission" : "permissions"}
                      {" · "}
                      {memberCountByRole.get(role.role) ?? 0} members
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditor({ mode: "edit", role })}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(role)}
                  >
                    Delete
                  </Button>
                </div>
              )
            })}
      </div>

      {editor && (
        <RoleEditor
          // Reset the form when switching between roles / create
          key={editor.mode === "edit" ? editor.role.id : "create"}
          editor={editor}
          workspaceId={workspaceId}
          onClose={() => setEditor(null)}
        />
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
