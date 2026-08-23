import {
  Delete02Icon,
  Search01Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { apiClient } from "@/lib/api-client"

// Manage the member list of the project owning `categoryChannelId` — one
// member list per project, shared by every channel inside.
export function ProjectMembersDialog({
  categoryChannelId,
  open,
  onOpenChange,
}: {
  categoryChannelId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const [memberQuery, setMemberQuery] = useState("")
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string
    name: string
  } | null>(null)

  const { data: projectsData } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects.$get(
        { param: { workspaceSlug: workspaceSlug as string } }
      )
      if (!res.ok) throw new Error("Failed to fetch projects")
      return res.json()
    },
    enabled: !!workspaceSlug && open,
  })
  const project = projectsData?.projects.find(
    (p) => p.categoryChannelId === categoryChannelId
  )

  const { data: detail } = useQuery({
    queryKey: ["project", workspaceSlug, project?.id],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects[
        ":projectId"
      ].$get({
        param: {
          workspaceSlug: workspaceSlug as string,
          projectId: project?.id as string,
        },
      })
      if (!res.ok) throw new Error("Failed to fetch project")
      return res.json()
    },
    enabled: !!workspaceSlug && !!project?.id && open,
  })

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug && open,
  })

  const projectMemberIds = useMemo(
    () => new Set(detail?.members.map((m) => m.id) ?? []),
    [detail]
  )
  const addableMembers = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase()
    return (membersData?.members ?? [])
      .filter((m) => !m.isBot && !projectMemberIds.has(m.userId))
      .filter((m) => !normalized || m.name.toLowerCase().includes(normalized))
  }, [membersData, projectMemberIds, memberQuery])

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["project", workspaceSlug, project?.id],
    })
    // Membership changes what the affected user's sidebar shows.
    void queryClient.invalidateQueries({
      queryKey: ["channels", workspaceSlug],
    })
  }

  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      if (!workspaceSlug || !project?.id) {
        throw new Error("Project not loaded yet")
      }
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects[
        ":projectId"
      ].members.$post({
        param: {
          workspaceSlug,
          projectId: project.id,
        },
        json: { userId },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          (data as { message?: string } | null)?.message ?? "Failed to add"
        )
      }
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  })

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      if (!workspaceSlug || !project?.id) {
        throw new Error("Project not loaded yet")
      }
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects[
        ":projectId"
      ].members[":userId"].$delete({
        param: {
          workspaceSlug,
          projectId: project.id,
          userId,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          (data as { message?: string } | null)?.message ?? "Failed to remove"
        )
      }
    },
    onSuccess: () => {
      invalidate()
      setPendingRemoval(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const busy = addMember.isPending || removeMember.isPending
  const pendingIsSelf = pendingRemoval?.id === currentUserId

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Project members</DialogTitle>
            <DialogDescription>
              {detail?.audience === "members"
                ? "Members can see every channel in this project. Everyone else can't see it at all."
                : "The roster for this project. Its channels are visible to the whole workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {!detail ? (
              <div className="flex justify-center py-6">
                <Spinner className="size-5" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-0.5">
                  {detail.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-foreground/[0.04]"
                    >
                      <UserAvatar name={m.name} src={m.image} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {m.name}
                        {m.id === currentUserId && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            you
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          m.id === currentUserId
                            ? "Leave project"
                            : `Remove ${m.name}`
                        }
                        disabled={busy}
                        onClick={() =>
                          setPendingRemoval({ id: m.id, name: m.name })
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <HugeiconsIcon
                      icon={Search01Icon}
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={2}
                    />
                    <input
                      value={memberQuery}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      placeholder="Add members"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto p-1">
                    {addableMembers.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Everyone's already here
                      </p>
                    ) : (
                      addableMembers.map((m) => (
                        <button
                          key={m.userId}
                          type="button"
                          disabled={busy}
                          onClick={() => addMember.mutate(m.userId)}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                        >
                          <UserAvatar
                            name={m.name}
                            src={m.image}
                            avatarColor={m.avatarColor}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {m.name}
                          </span>
                          <HugeiconsIcon
                            icon={UserAdd01Icon}
                            className="size-4 shrink-0 text-muted-foreground"
                            strokeWidth={2}
                          />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!pendingRemoval}
        onOpenChange={(next) => {
          if (!next && removeMember.isPending) return
          if (!next) setPendingRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingIsSelf ? "Leave project" : "Remove member"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingIsSelf
                ? "Are you sure you want to leave this project?"
                : `Are you sure you want to remove ${pendingRemoval?.name} from this project?`}
              {detail?.audience === "members" &&
                " Its channels will no longer be visible."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={removeMember.isPending}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={removeMember.isPending}
              onClick={() => {
                if (pendingRemoval) removeMember.mutate(pendingRemoval.id)
              }}
            >
              {pendingIsSelf ? "Leave Project" : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
