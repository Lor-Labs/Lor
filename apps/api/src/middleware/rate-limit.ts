import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context, Next } from "hono"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import type { AppBindings } from "@/lib/types/app-types"

const WINDOW_SECONDS = 60
const KEY_TTL_SECONDS = 90

interface RateLimitConfig {
  /** Requests per window */
  max: number
  /** Window size in seconds (default 60) */
  window?: number
  /** Key prefix for Redis */
  prefix: string
  /** Extract the identifier from the request (default: IP address) */
  keyExtractor?: (c: Context<AppBindings>) => string
}

// Client IP behind Cloudflare → Railway: Cloudflare sets cf-connecting-ip to
// the client, Railway's edge sets x-real-ip to the connecting address.
// X-Forwarded-For is client-controlled and never used. The origin must only
// accept traffic through Cloudflare, or cf-connecting-ip is spoofable.
function getIp(c: Context<AppBindings>): string {
  const header =
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-real-ip")?.trim()
  if (header) return header
  try {
    return getConnInfo(c).remote.address ?? "unknown"
  } catch {
    return "unknown"
  }
}

function getWindowNumber(windowSeconds: number): number {
  return Math.floor(Date.now() / (windowSeconds * 1000))
}

function getRetryAfterSeconds(windowSeconds: number): number {
  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds
  return Math.max(1, windowSeconds - elapsed)
}

export function rateLimiter(config: RateLimitConfig) {
  const windowSeconds = config.window ?? WINDOW_SECONDS

  return async (c: Context<AppBindings>, next: Next) => {
    try {
      const redis = await getRedisClient()
      const identifier = config.keyExtractor ? config.keyExtractor(c) : getIp(c)

      const windowNum = getWindowNumber(windowSeconds)
      const key = `ratelimit:api:${config.prefix}:${identifier}:${windowNum}`

      const count = await redis.incr(key)
      if (count === 1) {
        await redis.expire(
          key,
          config.window ? config.window + 30 : KEY_TTL_SECONDS
        )
      }

      c.header("X-RateLimit-Limit", String(config.max))
      c.header("X-RateLimit-Remaining", String(Math.max(0, config.max - count)))

      if (count > config.max) {
        const retryAfter = getRetryAfterSeconds(windowSeconds)
        c.header("Retry-After", String(retryAfter))
        c.header("X-RateLimit-Remaining", "0")
        return c.json(
          {
            success: false,
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds`,
          },
          HttpStatusCodes.TOO_MANY_REQUESTS
        )
      }
    } catch (err) {
      // Fails open: a Redis outage lifts every API limit (global, write,
      // waitlist) rather than taking the API down.
      logger.warn({ err }, "Redis unavailable, failing open")
    }

    await next()
  }
}

/** Global rate limit: 100 requests/min per IP */
export const globalRateLimit = rateLimiter({
  prefix: "global",
  max: 100,
})

/** Stricter rate limit for write operations: 30 requests/min per user */
export const writeRateLimit = rateLimiter({
  prefix: "write",
  max: 30,
  keyExtractor: (c) => c.get("user")?.id ?? getIp(c),
})

/**
 * Composer connector lookups: 60 requests/min per user. Each one can hit a
 * third-party API on a quota the whole workspace shares, so one member typing
 * (or scripting) must not drain it. Runs after workspace auth, so the user is
 * resolved by the time the key is built.
 */
export const connectorLookupRateLimit = rateLimiter({
  prefix: "connector-lookup",
  max: 60,
  keyExtractor: (c) => c.get("user")?.id ?? getIp(c),
})

/**
 * Public waitlist signups: 60/min per IP. apps/www proxies from its server,
 * so all its visitors share that server's bucket; keep it launch-day sized.
 */
export const waitlistRateLimit = rateLimiter({
  prefix: "waitlist",
  max: 60,
})

/** Onboarding company-site lookups: 10/min per user, each costs Exa + model. */
export const siteLookupRateLimit = rateLimiter({
  prefix: "site-lookup",
  max: 10,
  keyExtractor: (c) => c.get("user")?.id ?? getIp(c),
})
