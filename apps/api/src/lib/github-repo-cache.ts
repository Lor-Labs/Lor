import { githubReposCacheKey, setRepoCacheStore } from "@repo/lor/github"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Back Lor's GitHub caches (repo list, repo trees) with Redis in this process
// too — the composer's connector menu resolves them from the API, not just the
// worker. Without it every keystroke in the file picker refetches the repo tree.
export function installGithubCaches(): void {
  setRepoCacheStore({
    get: async (key) => {
      const redis = await getRedisClient()
      return redis.get(key)
    },
    set: async (key, value, ttlSeconds) => {
      const redis = await getRedisClient()
      await redis.set(key, value, { EX: ttlSeconds })
    },
  })
}

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
