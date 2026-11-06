import type { SessionReport } from "./detect"

// Who is editing what, right now. In-memory for the standalone watcher;
// Redis inside Lor, where several worker processes report at once.
export type OverlapStore = {
  // Replaces the session's previous report.
  put(report: SessionReport, ttlMs: number): Promise<void>
  list(scope: string): Promise<SessionReport[]>
  remove(scope: string, sessionId: string): Promise<void>
  // True the first time a key is claimed within ttlMs: alert dedupe.
  claim(key: string, ttlMs: number): Promise<boolean>
}

export function createMemoryStore(now: () => number = Date.now): OverlapStore {
  const scopes = new Map<string, Map<string, SessionReport>>()
  const claims = new Map<string, number>()
  return {
    async put(report) {
      let sessions = scopes.get(report.scope)
      if (!sessions) {
        sessions = new Map()
        scopes.set(report.scope, sessions)
      }
      sessions.set(report.sessionId, report)
    },
    async list(scope) {
      return [...(scopes.get(scope)?.values() ?? [])]
    },
    async remove(scope, sessionId) {
      scopes.get(scope)?.delete(sessionId)
    },
    async claim(key, ttlMs) {
      const expires = claims.get(key)
      if (expires !== undefined && expires > now()) return false
      claims.set(key, now() + ttlMs)
      return true
    },
  }
}

// The few Redis commands the store needs, so this package has no Redis
// dependency: the host passes thin wrappers over its own client.
export type RedisCommands = {
  hSet(key: string, field: string, value: string): Promise<unknown>
  hGetAll(key: string): Promise<Record<string, string>>
  hDel(key: string, field: string): Promise<unknown>
  pExpire(key: string, ms: number): Promise<unknown>
  // SET key value NX PX ms; true when the key was set.
  setNx(key: string, value: string, ms: number): Promise<boolean>
}

// One hash per scope: field = session id, value = the report as JSON. The
// hash expires when no session in the scope reported for ttlMs; stale fields
// inside a live hash are filtered (and pruned) by the tracker.
export function createRedisStore(
  redis: RedisCommands,
  prefix = "overlap"
): OverlapStore {
  const scopeKey = (scope: string) => `${prefix}:scope:${scope}`
  return {
    async put(report, ttlMs) {
      const key = scopeKey(report.scope)
      await redis.hSet(key, report.sessionId, JSON.stringify(report))
      await redis.pExpire(key, ttlMs)
    },
    async list(scope) {
      const fields = await redis.hGetAll(scopeKey(scope))
      const reports: SessionReport[] = []
      for (const value of Object.values(fields)) {
        try {
          reports.push(JSON.parse(value) as SessionReport)
        } catch {
          // A malformed field is skipped, never fatal.
        }
      }
      return reports
    },
    async remove(scope, sessionId) {
      await redis.hDel(scopeKey(scope), sessionId)
    },
    claim(key, ttlMs) {
      return redis.setNx(`${prefix}:alert:${key}`, "1", ttlMs)
    },
  }
}
