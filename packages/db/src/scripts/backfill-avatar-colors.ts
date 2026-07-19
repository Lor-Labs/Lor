import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { asc, eq } from "drizzle-orm"
import { db, schema } from "../index"

const memberships = await db
  .select({
    id: schema.workspaceMember.id,
    workspaceId: schema.workspaceMember.workspaceId,
    userId: schema.workspaceMember.userId,
  })
  .from(schema.workspaceMember)
  .orderBy(
    asc(schema.workspaceMember.workspaceId),
    asc(schema.workspaceMember.createdAt),
    asc(schema.workspaceMember.id)
  )

const colorsByWorkspace = new Map<string, string[]>()

await db.transaction(async (tx) => {
  for (const membership of memberships) {
    const usedColors = colorsByWorkspace.get(membership.workspaceId) ?? []
    const avatarColor = pickWorkspaceAvatarColor(
      usedColors,
      `${membership.workspaceId}:${membership.userId}`
    )

    await tx
      .update(schema.workspaceMember)
      .set({ avatarColor })
      .where(eq(schema.workspaceMember.id, membership.id))

    usedColors.push(avatarColor)
    colorsByWorkspace.set(membership.workspaceId, usedColors)
  }
})

console.log(
  `Assigned avatar colors to ${memberships.length} memberships across ${colorsByWorkspace.size} workspaces.`
)
process.exit(0)
