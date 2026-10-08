import { getRedisClient } from "@/lib/redis"

// GitHub connect intent: which workspace a user is connecting GitHub to.
// Reconnecting to an existing installation goes through GitHub's configure
// page, whose redirect can come back without `state`; this record still
// names the workspace. One pending connect per user.
const INTENT_TTL_SECONDS = 15 * 60

const intentKey = (userId: string) => `github:connect-intent:${userId}`

export async function recordGithubConnectIntent(
  userId: string,
  workspaceId: string
) {
  const redis = await getRedisClient()
  await redis.set(intentKey(userId), workspaceId, { EX: INTENT_TTL_SECONDS })
}

export async function readGithubConnectIntent(userId: string) {
  const redis = await getRedisClient()
  return redis.get(intentKey(userId))
}

export async function clearGithubConnectIntent(userId: string) {
  const redis = await getRedisClient()
  await redis.del(intentKey(userId))
}
