import { authClient } from "@repo/auth/client"

export const workspaceInvitationsQueryKey = (workspaceId: string | undefined) =>
  ["workspace-invitations", workspaceId] as const

// better-auth's accept returns ids only; the slug comes from the workspace list.
export async function acceptInvitation(invitationId: string) {
  const accepted = await authClient.organization.acceptInvitation({
    invitationId,
  })
  if (accepted.error) {
    throw new Error(accepted.error.message ?? "Couldn't accept the invite")
  }
  const workspaces = await authClient.organization.list()
  const workspace = workspaces.data?.find(
    (w) => w.id === accepted.data.member.organizationId
  )
  if (!workspace) throw new Error("Couldn't open the workspace")
  return workspace
}
