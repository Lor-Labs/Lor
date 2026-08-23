import type { schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"

export type AccessibleChannel = {
  id: string
  name: string | null
  type: (typeof schema.channel.$inferSelect)["type"]
  workspaceId: string | null
  workspaceName: string | null
  memberRole: string | null
  memberIsOwner: boolean
  /** False when the channel is archived — sends/edits/reactions must be rejected. */
  canWrite: boolean
}

// Thin wrapper over the shared audience resolver (@repo/db/queries) — keeps
// the throw-based contract the socket handlers expect.
export async function assertUserCanAccessChannel(
  userId: string,
  channelId: string
): Promise<AccessibleChannel> {
  const result = await resolveChannelAccess(userId, channelId)

  if (!result.ok) {
    // One error for missing and forbidden alike — not probeable via acks.
    throw new Error("Channel not found")
  }

  if (result.access.channel.type === "category") {
    throw new Error("Cannot join a category channel")
  }

  return {
    id: result.access.channel.id,
    name: result.access.channel.name,
    type: result.access.channel.type,
    workspaceId: result.access.channel.workspaceId,
    workspaceName: result.access.channel.workspaceName,
    memberRole: result.access.memberRole,
    memberIsOwner: result.access.memberIsOwner,
    canWrite: result.access.canWrite,
  }
}
