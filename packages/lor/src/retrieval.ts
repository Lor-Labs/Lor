import { type AnyColumn, and, db, ilike, type SQL, schema, sql } from "@repo/db"

// How a person appears everywhere in the app (message author header, mention
// pill, composer): their real name. Lor reads and mentions people by this same
// label so its prose and pills stay consistent — and it matches the identity
// external apps (Linear, GitHub) know them by.
export function userDisplayName(u: { name: string }): string {
  return u.name
}

// websearch_to_tsquery ANDs its terms, so a natural-language query returns
// nothing unless a single row contains every content word. Rewrite the AND
// (&) operators to OR (|) so it degrades gracefully — a row matching some
// terms still surfaces, ranked below fuller matches by ts_rank. The websearch
// parser still handles stopword removal, stemming, and sanitizing the raw
// user text for us.
export function orTsQuery(query: string) {
  return sql`replace(websearch_to_tsquery('english', ${query})::text, '&', '|')::tsquery`
}

// `search` filters the model fills in. A kind that can't apply a given filter
// is skipped rather than searched unfiltered.
// reference/planned/context-engine-phase-2.md Step 7.
export type SearchFilters = {
  author?: string
  channel?: string
  since?: Date
  until?: Date
}

// "2026-10-01" or a full ISO time; null when it isn't a date. A bare date as
// `until` includes that whole day.
export function parseFilterDate(
  value: string | undefined,
  { endOfDay }: { endOfDay: boolean }
): Date | null | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return date
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

// Case-insensitive substring, so "ana" matches "Ana Ruiz" and the login
// "anaz".
export function authorFilter(column: AnyColumn, author: string | undefined) {
  const value = author?.trim()
  return value ? ilike(column, `%${escapeLike(value)}%`) : undefined
}

// Case-insensitive exact channel name; a leading # is ignored. Needs the
// channel join.
export function channelFilter(channel: string | undefined) {
  const value = channel?.trim().replace(/^#/, "").toLowerCase()
  return value ? sql`lower(${schema.channel.name}) = ${value}` : undefined
}

// Timestamps are stored as UTC wall-clock `timestamp` (Drizzle drops the
// zone), so compare against the ISO string cast the same way.
export function dateFilter(column: AnyColumn | SQL, filters: SearchFilters) {
  return and(
    filters.since
      ? sql`${column} >= ${filters.since.toISOString()}::timestamp`
      : undefined,
    filters.until
      ? sql`${column} < ${filters.until.toISOString()}::timestamp`
      : undefined
  )
}

const RRF_K = 60

// Reciprocal rank fusion of ranked lists (keyword, vector): each list adds
// 1 / (k + rank) per row, so rows found by both rise. Best first.
export function fuseByRank<T>(lists: T[][], key: (row: T) => string): T[] {
  const scored = new Map<string, { row: T; score: number }>()
  for (const list of lists) {
    list.forEach((row, rank) => {
      const id = key(row)
      const entry = scored.get(id) ?? { row, score: 0 }
      entry.score += 1 / (RRF_K + rank + 1)
      scored.set(id, entry)
    })
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row)
}

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// A filtered HNSW scan can return a short list: the index yields the nearest
// rows, then the workspace or audience filter drops most of them. Iterative
// scan keeps reading until the limit fills (pgvector 0.8+); strict_order keeps
// exact distance order. reference/planned/context-engine.md §6 #5.
export function withIterativeScan<T>(
  run: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local hnsw.iterative_scan = strict_order`)
    return run(tx)
  })
}

// Effective audience lives on the access container (parent category or the
// channel itself); mirror of the shared resolver's rule, in SQL. A scalar
// subquery keeps drizzle happy where a self-alias join breaks its typing.
export function privateAudienceFilter(
  privateContainerChannelId: string | null
) {
  const effectiveAudience = sql`coalesce((select p."audience" from "channel" p where p."id" = ${schema.channel.parentId}), ${schema.channel.audience})`
  const containerId = sql`coalesce(${schema.channel.parentId}, ${schema.channel.id})`
  return privateContainerChannelId
    ? sql`(${effectiveAudience} = 'workspace' or ${containerId} = ${privateContainerChannelId}::uuid)`
    : sql`${effectiveAudience} = 'workspace'`
}
