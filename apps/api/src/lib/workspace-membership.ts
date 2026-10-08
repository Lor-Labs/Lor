import { grantFirstInvitePromo, syncSeats } from "@repo/billing"
import { type db, eq, schema } from "@repo/db"
import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { companyEmailDomain } from "@repo/utils/domain"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Joins a user as a plain member with the workspace's least-used avatar
// color. Runs in the caller's transaction, so invite accept counts the use in
// the same commit. Returns false when they were already a member.
export async function addWorkspaceMember(
  tx: Tx,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const usedAvatarColors = await tx
    .select({ avatarColor: schema.workspaceMember.avatarColor })
    .from(schema.workspaceMember)
    .where(eq(schema.workspaceMember.workspaceId, workspaceId))
  const avatarColor = pickWorkspaceAvatarColor(
    usedAvatarColors.map((membership) => membership.avatarColor),
    `${workspaceId}:${userId}`
  )
  const inserted = await tx
    .insert(schema.workspaceMember)
    .values({
      workspaceId,
      userId,
      role: "member",
      createdAt: new Date(),
      avatarColor,
    })
    .onConflictDoNothing()
    .returning({ id: schema.workspaceMember.id })
  return inserted.length > 0
}

// Fire-and-forget after a join commits: billing must never block a join. Both
// self-heal — syncSeats recomputes from scratch, the promo claim retries.
export function afterWorkspaceJoin(workspaceId: string) {
  void syncSeats(workspaceId)
  void grantFirstInvitePromo(workspaceId)
}

// Join by email domain only trusts a verified, non-free email domain.
export function verifiedCompanyDomain(user: {
  email: string
  emailVerified: boolean
}): string | null {
  return user.emailVerified ? companyEmailDomain(user.email) : null
}
