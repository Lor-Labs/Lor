import { Copy01Icon, MailSend01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import { useInviteAccess } from "@/hooks/use-invite-access"
import { apiClient } from "@/lib/api-client"
import { workspaceInvitationsQueryKey } from "@/lib/invitations"
import { getInviteUrl } from "@/lib/invite-url"
import { formatWorkspaceRole } from "@/lib/permissions"

type RevokeTarget =
  | { kind: "link"; code: string }
  | { kind: "email"; invitationId: string }

function formatExpiry(expiresAt: string | Date | null) {
  if (!expiresAt) return "Never"
  const date = new Date(expiresAt)
  const now = Date.now()
  const diff = date.getTime() - now
  if (diff <= 0) return "Expired"
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) return `${Math.floor(hours / 24)}d`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function ManageInvitesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const { workspaceId } = useInviteAccess(workspaceSlug)

  const { data, isPending, isError } = useQuery({
    queryKey: ["workspace-invites", workspaceSlug],
    queryFn: async () => {
      if (!workspaceSlug) throw new Error("Missing workspace slug")
      const res = await apiClient.v1.workspaces[":workspaceSlug"].invites.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch invites")
      return res.json()
    },
    enabled: open && !!workspaceSlug,
  })

  // better-auth returns every status; only open invitations are manageable.
  const invitations = useQuery({
    queryKey: workspaceInvitationsQueryKey(workspaceId),
    queryFn: async () => {
      const res = await authClient.organization.listInvitations({
        query: { organizationId: workspaceId },
      })
      if (res.error) throw new Error(res.error.message ?? "Failed")
      return res.data.filter(
        (invitation) =>
          invitation.status === "pending" &&
          new Date(invitation.expiresAt).getTime() > Date.now()
      )
    },
    enabled: open && !!workspaceId,
  })

  const resendMutation = useMutation({
    mutationFn: async (invitation: { email: string; role: string }) => {
      const { error } = await authClient.organization.inviteMember({
        email: invitation.email,
        role: invitation.role,
        organizationId: workspaceId,
        resend: true,
      })
      if (error) throw new Error(error.message ?? "Failed to resend invite")
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workspaceInvitationsQueryKey(workspaceId),
      })
      toast.success("Invite resent")
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const revokeMutation = useMutation({
    mutationFn: async (target: RevokeTarget) => {
      if (target.kind === "email") {
        const { error } = await authClient.organization.cancelInvitation({
          invitationId: target.invitationId,
        })
        if (error) throw new Error("Failed to revoke invite")
        return
      }
      if (!workspaceSlug) throw new Error("Missing workspace slug")
      const res = await apiClient.v1.workspaces[":workspaceSlug"].invites[
        ":code"
      ].$delete({
        param: { workspaceSlug, code: target.code },
      })
      if (!res.ok) throw new Error("Failed to revoke invite")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceSlug],
      })
      queryClient.invalidateQueries({
        queryKey: workspaceInvitationsQueryKey(workspaceId),
      })
    },
    onError: () => {
      toast.error("Failed to revoke invite")
    },
  })

  async function handleCopy(code: string, anchor: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(getInviteUrl(code))
      anchoredToastManager.add({
        data: { tooltipStyle: true },
        id: `copy-invite-${code}`,
        positionerProps: { anchor, sideOffset: 6 },
        timeout: 1800,
        title: "Invite link copied",
      })
    } catch {
      toast.error("Failed to copy")
    }
  }

  const invites = data?.invites ?? []
  const pendingInvitations = invitations.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workspace Invites</DialogTitle>
          <DialogDescription>
            View and manage pending email invites and active invite links.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[28rem] space-y-6 overflow-y-auto">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Email Invites</h3>
            {invitations.isPending ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Loading invites...
              </div>
            ) : invitations.isError ? (
              <div className="py-4 text-center text-sm text-destructive">
                Failed to load invites. Try closing and reopening.
              </div>
            ) : pendingInvitations.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No pending email invites
              </div>
            ) : (
              <div>
                <AnimatePresence initial={false}>
                  {pendingInvitations.map((invitation) => (
                    <motion.div
                      key={invitation.id}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <div className="mb-2 flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {invitation.email}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatWorkspaceRole(invitation.role)} — expires{" "}
                            {formatExpiry(invitation.expiresAt)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Resend invite to ${invitation.email}`}
                            disabled={resendMutation.isPending}
                            onClick={() => resendMutation.mutate(invitation)}
                          >
                            <HugeiconsIcon
                              icon={MailSend01Icon}
                              className="size-3.5"
                              strokeWidth={2}
                            />
                          </Button>
                          <InlineConfirmButton
                            label={`Revoke invite to ${invitation.email}`}
                            confirmLabel="Revoke"
                            onConfirm={() =>
                              revokeMutation.mutateAsync({
                                kind: "email",
                                invitationId: invitation.id,
                              })
                            }
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Invite Links</h3>
            {isPending ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Loading invites...
              </div>
            ) : isError ? (
              <div className="py-4 text-center text-sm text-destructive">
                Failed to load invites. Try closing and reopening.
              </div>
            ) : invites.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No active invite links
              </div>
            ) : (
              <div>
                <AnimatePresence initial={false}>
                  {invites.map((invite) => (
                    <motion.div
                      key={invite.id}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <div className="mb-2 flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              {invite.code}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {invite.uses}
                              {invite.maxUses !== null
                                ? `/${invite.maxUses}`
                                : ""}{" "}
                              uses
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            by {invite.inviter.name} — expires{" "}
                            {formatExpiry(invite.expiresAt)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Copy invite ${invite.code}`}
                            onClick={(event) =>
                              void handleCopy(invite.code, event.currentTarget)
                            }
                          >
                            <HugeiconsIcon
                              icon={Copy01Icon}
                              className="size-3.5"
                              strokeWidth={2}
                            />
                          </Button>
                          <InlineConfirmButton
                            label={`Revoke invite ${invite.code}`}
                            confirmLabel="Revoke"
                            onConfirm={() =>
                              revokeMutation.mutateAsync({
                                kind: "link",
                                code: invite.code,
                              })
                            }
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  )
}
