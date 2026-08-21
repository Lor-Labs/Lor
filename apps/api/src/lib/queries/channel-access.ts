import { resolveChannelAccess } from "@repo/db/queries/channel-access"

// Thin wrapper over the shared audience resolver — kept for the many existing
// call sites. New code that needs channel details should call
// resolveChannelAccess directly.
export async function userCanAccessChannel(channelId: string, userId: string) {
  const result = await resolveChannelAccess(userId, channelId)
  return result.ok
}
