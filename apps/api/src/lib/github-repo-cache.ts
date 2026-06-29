import { githubReposCacheKey } from "@repo/merlin/github"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Drop the cached repo list for an installation so the next resolve re-fetches
// from GitHub. Called when a connection's repo access can have changed (connect,
// disconnect, installation_repositories webhook). Best-effort — the TTL is the
// backstop, so a Redis hiccup here is non-fatal.
export async function invalidateGithubRepoCache(
  installationId: string
): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.del(githubReposCacheKey(installationId))
  } catch (err) {
    logger.warn(
      { err, installationId },
      "Failed to invalidate GitHub repo cache"
    )
  }
}
