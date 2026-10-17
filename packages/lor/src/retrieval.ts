import { db, type SQL, schema, sql } from "@repo/db"

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
// terms still surfaces, ranked below fuller matches. The websearch parser
// still handles stopword removal, stemming, and sanitizing the raw user text
// for us.
export function orTsQuery(query: string) {
  return sql`replace(websearch_to_tsquery('english', ${query})::text, '&', '|')::tsquery`
}

// BM25 relevance (pg_textsearch) of `text` for the query, scored with the
// named index's corpus statistics. Matches score below 0: order ascending.
// The tsquery filter still decides which rows match; this only orders them.
// The index is named because the planner can't infer it for prepared
// statements. reference/planned/context-engine-phase-2.md Step 6.
export function bm25Score(text: SQL, query: string, indexName: string) {
  return sql<number>`(${text} <@> to_bm25query(${query}::text, ${indexName}::text))`
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
