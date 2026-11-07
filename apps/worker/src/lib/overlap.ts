import type { ClaimOverlapNotice } from "@repo/lor/session-overlap"
import type { createClient } from "redis"

type RedisClient = ReturnType<typeof createClient>

const NOTICE_COOLDOWN_MS = 6 * 60 * 60_000

// Overlap notes (packages/lor/src/session-overlap.ts): a session's agent hears
// about another session's edits to a file once per cooldown. The keys expire
// on their own.
export function overlapNoticeClaim(redis: RedisClient): ClaimOverlapNotice {
  return async (key) =>
    (await redis.set(`overlap:notice:${key}`, "1", {
      NX: true,
      PX: NOTICE_COOLDOWN_MS,
    })) === "OK"
}
