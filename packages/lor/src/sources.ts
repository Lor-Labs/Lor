import { createHash } from "node:crypto"
import {
  and,
  cosineDistance,
  db,
  eq,
  inArray,
  isNotNull,
  schema,
  sql,
} from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { splitText } from "./attachments/split"
import { embedDocumentsWithUsage, embedSourceQuery } from "./embeddings"
import { logger } from "./logger"
import {
  type DbTransaction,
  fuseByRank,
  orTsQuery,
  withIterativeScan,
} from "./retrieval"
import { emitUsage, type OnUsage } from "./usage"

// Items from connected services, stored as real text and searched over
// chunks. A search index, not a mirror: webhooks refetch on a best-effort
// basis, and anything that needs current state is fetched live.
// See reference/planned/context-engine-phase-2.md.

// Reject malformed citation ids before querying.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const BODY_MAX = 200_000
const CHUNK_CHARS = 2000
const MAX_CHUNKS = 60
const EMBED_BATCH_SIZE = 32
const POOL_FACTOR = 3
// One long PR thread would otherwise fill every result slot.
const MAX_HITS_PER_SOURCE = 2
const FETCH_PAGE_CHARS = 20_000

// Must match the source_chunk_text_tsv_idx expression exactly.
const chunkTsv = sql`to_tsvector('english', ${schema.sourceChunk.text})`

type NewSource = typeof schema.source.$inferInsert

export type SourceConnection = Pick<
  typeof schema.integrationConnection.$inferSelect,
  "id" | "workspaceId" | "provider"
>

export type SourceItem = Pick<
  NewSource,
  | "kind"
  | "externalId"
  | "url"
  | "title"
  | "author"
  | "state"
  | "sourceCreatedAt"
  | "sourceUpdatedAt"
> & { body: string }

export type SourceHit = {
  id: string
  provider: string
  kind: string
  title: string
  author: string | null
  url: string | null
  state: string | null
  when: string
  // When the stored copy was last fetched. Not a mirror: it can be stale.
  syncedAt: string | null
  text: string
  truncated?: true
}

// Connecting a service shares what it can see with the whole workspace
// (reference/planned/session-memory.md, permission rules). Requires the
// connection join.
function visibleSource(workspaceId: string) {
  return and(
    eq(schema.source.workspaceId, workspaceId),
    eq(schema.source.status, "active"),
    eq(schema.integrationConnection.status, "active")
  )
}

function chunkTexts(title: string, body: string): string[] {
  const pieces = splitText(body, CHUNK_CHARS).slice(0, MAX_CHUNKS)
  return pieces.length > 0 ? pieces.map((p) => `${title}\n\n${p}`) : [title]
}

async function embedChunks(
  workspaceId: string,
  texts: string[],
  onUsage?: OnUsage
): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    try {
      const r = await embedDocumentsWithUsage(batch)
      emitUsage(onUsage, {
        workspaceId,
        tool: "source.embed",
        model: r.model,
        inputTokens: r.tokens,
      })
      out.push(...r.embeddings)
    } catch (err) {
      // Keyword search still finds the chunk; reembed fills the vector later.
      logger.warn({ err }, "Source chunk embed failed")
      out.push(...batch.map(() => null))
    }
  }
  return out
}

// Saves a fetched item. An older fetch that finishes after a newer one never
// overwrites it, and chunks are rebuilt (and re-embedded) only when the text
// changed.
export async function storeSourceItem(
  connection: SourceConnection,
  item: SourceItem,
  onUsage?: OnUsage
): Promise<"stored" | "unchanged" | "stale"> {
  const body = item.body.slice(0, BODY_MAX)
  const contentHash = createHash("sha256")
    .update(`${item.title}\n${item.state ?? ""}\n${body}`)
    .digest("hex")
  const key = and(
    eq(schema.source.workspaceId, connection.workspaceId),
    eq(schema.source.provider, connection.provider),
    eq(schema.source.externalId, item.externalId)
  )
  const existing = await db
    .select({
      contentHash: schema.source.contentHash,
      status: schema.source.status,
    })
    .from(schema.source)
    .where(key)
    .limit(1)
    .then((r) => r[0])
  const changed =
    !existing ||
    existing.contentHash !== contentHash ||
    existing.status !== "active"

  const texts = changed ? chunkTexts(item.title, body) : []
  const embeddings = changed
    ? await embedChunks(connection.workspaceId, texts, onUsage)
    : []

  const columns = {
    connectionId: connection.id,
    kind: item.kind,
    url: item.url ?? null,
    title: item.title,
    author: item.author ?? null,
    state: item.state ?? null,
    body,
    contentHash,
    sourceCreatedAt: item.sourceCreatedAt ?? null,
    sourceUpdatedAt: item.sourceUpdatedAt ?? null,
    fetchedAt: new Date(),
    status: "active" as const,
  }
  return db.transaction(async (tx) => {
    const written = await tx
      .insert(schema.source)
      .values({
        workspaceId: connection.workspaceId,
        provider: connection.provider,
        externalId: item.externalId,
        ...columns,
      })
      .onConflictDoUpdate({
        target: [
          schema.source.workspaceId,
          schema.source.provider,
          schema.source.externalId,
        ],
        set: columns,
        setWhere: sql`${schema.source.sourceUpdatedAt} is null or excluded.source_updated_at is null or excluded.source_updated_at >= ${schema.source.sourceUpdatedAt}`,
      })
      .returning({ id: schema.source.id })
      .then((r) => r[0])
    if (!written) return "stale"
    if (!changed) return "unchanged"

    await tx
      .delete(schema.sourceChunk)
      .where(eq(schema.sourceChunk.sourceId, written.id))
    await tx.insert(schema.sourceChunk).values(
      texts.map((text, position) => ({
        workspaceId: connection.workspaceId,
        sourceId: written.id,
        position,
        text,
        embedding: embeddings[position] ?? null,
      }))
    )
    return "stored"
  })
}

// Deleted at the service, or out of the connection's reach: keep the row as a
// tombstone, drop its text and chunks.
async function tombstoneWhere(where: ReturnType<typeof and>) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.source)
      .set({ status: "archived", body: "", contentHash: null })
      .where(and(where, eq(schema.source.status, "active")))
      .returning({ id: schema.source.id })
    if (rows.length === 0) return
    await tx.delete(schema.sourceChunk).where(
      inArray(
        schema.sourceChunk.sourceId,
        rows.map((r) => r.id)
      )
    )
  })
}

export function tombstoneSource(connectionId: string, externalId: string) {
  return tombstoneWhere(
    and(
      eq(schema.source.connectionId, connectionId),
      eq(schema.source.externalId, externalId)
    )
  )
}

// e.g. every item of a repo removed from the GitHub installation.
export function tombstoneSourcesWithPrefix(
  connectionId: string,
  externalIdPrefix: string
) {
  return tombstoneWhere(
    and(
      eq(schema.source.connectionId, connectionId),
      sql`starts_with(${schema.source.externalId}, ${externalIdPrefix})`
    )
  )
}

function chunkCandidates(executor: Pick<DbTransaction, "select"> = db) {
  return executor
    .select({
      chunkId: schema.sourceChunk.id,
      sourceId: schema.source.id,
      provider: schema.source.provider,
      kind: schema.source.kind,
      title: schema.source.title,
      author: schema.source.author,
      url: schema.source.url,
      state: schema.source.state,
      sourceUpdatedAt: schema.source.sourceUpdatedAt,
      createdAt: schema.source.createdAt,
      fetchedAt: schema.source.fetchedAt,
      bodyLength: sql<number>`length(${schema.source.body})`,
      text: schema.sourceChunk.text,
    })
    .from(schema.sourceChunk)
    .innerJoin(schema.source, eq(schema.sourceChunk.sourceId, schema.source.id))
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .$dynamic()
}

type ChunkCandidate = Awaited<ReturnType<typeof chunkCandidates>>[number]

// Keyword and vector results merge by reciprocal rank fusion, like attachment
// and call search: identifiers and names from the keyword side, paraphrases
// from the vector side.
export async function searchSources(
  workspaceId: string,
  query: string,
  limit: number
): Promise<SourceHit[]> {
  const pool = limit * POOL_FACTOR
  const scope = visibleSource(workspaceId)
  const tsq = orTsQuery(query)
  const [keyword, vector] = await Promise.all([
    chunkCandidates()
      .where(and(scope, sql`${chunkTsv} @@ ${tsq}`))
      .orderBy(sql`ts_rank(${chunkTsv}, ${tsq}) desc`)
      .limit(pool),
    embedSourceQuery(query)
      .then((embedding) =>
        withIterativeScan((tx) =>
          chunkCandidates(tx)
            .where(and(scope, isNotNull(schema.sourceChunk.embedding)))
            .orderBy(cosineDistance(schema.sourceChunk.embedding, embedding))
            .limit(pool)
        )
      )
      .catch(() => [] as ChunkCandidate[]),
  ])

  const perSource = new Map<string, number>()
  return fuseByRank([keyword, vector], (row) => row.chunkId)
    .filter((row) => {
      const hits = perSource.get(row.sourceId) ?? 0
      perSource.set(row.sourceId, hits + 1)
      return hits < MAX_HITS_PER_SOURCE
    })
    .slice(0, limit)
    .map((row) => {
      const header = `${row.title}\n\n`
      const text = row.text.startsWith(header)
        ? row.text.slice(header.length)
        : row.text
      return {
        id: row.sourceId,
        provider: row.provider,
        kind: row.kind,
        title: row.title,
        author: row.author,
        url: row.url,
        state: row.state,
        when: (row.sourceUpdatedAt ?? row.createdAt).toISOString(),
        syncedAt: row.fetchedAt?.toISOString() ?? null,
        text,
        ...(row.bodyLength > text.length ? { truncated: true as const } : {}),
      }
    })
}

async function readStoredSource(
  workspaceId: string,
  id: string,
  offset: number
) {
  if (!UUID_REGEX.test(id)) return { error: "source not found" }
  const row = await db
    .select({
      provider: schema.source.provider,
      kind: schema.source.kind,
      title: schema.source.title,
      url: schema.source.url,
      author: schema.source.author,
      state: schema.source.state,
      body: schema.source.body,
      sourceUpdatedAt: schema.source.sourceUpdatedAt,
      fetchedAt: schema.source.fetchedAt,
    })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .where(and(eq(schema.source.id, id), visibleSource(workspaceId)))
    .limit(1)
    .then((r) => r[0])
  if (!row) return { error: "source not found" }

  const start = Math.min(Math.max(0, Math.floor(offset)), row.body.length)
  const end = Math.min(start + FETCH_PAGE_CHARS, row.body.length)
  return {
    provider: row.provider,
    kind: row.kind,
    title: row.title,
    url: row.url,
    author: row.author,
    state: row.state,
    updatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    syncedAt: row.fetchedAt?.toISOString() ?? null,
    text: row.body.slice(start, end),
    ...(end < row.body.length
      ? { nextOffset: end, totalChars: row.body.length }
      : {}),
  }
}

export const sourceTools = {
  fetch_source: tool({
    description:
      "Read a stored item from a connected service (a GitHub pull request or issue, a Linear issue, an Attio note or call transcript): its description and discussion as of the last sync (`syncedAt`). This tool does not contact the service; use an enabled connector fetch tool for the live item. Long items come in pages: pass `nextOffset` back as `offset` to read on. Cite it as [[src:<id>]] with the same id you passed.",
    inputSchema: z.object({
      id: z.string().describe("a source id from search"),
      offset: z
        .number()
        .optional()
        .describe("character offset to read from (default 0)"),
    }),
    contextSchema: z.object({ workspaceId: z.string() }),
    execute: async ({ id, offset }, { context }) => {
      try {
        return await readStoredSource(context.workspaceId, id, offset ?? 0)
      } catch {
        return { error: "fetch failed" }
      }
    },
    strict: true,
  }),
}

// Grounding writes the title and url into the reply, so it applies the same
// visibility as search.
export async function resolveSourceCitation(
  workspaceId: string,
  id: string
): Promise<{ url: string | null; title: string } | null> {
  if (!UUID_REGEX.test(id)) return null
  const row = await db
    .select({ url: schema.source.url, title: schema.source.title })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .where(and(eq(schema.source.id, id), visibleSource(workspaceId)))
    .limit(1)
    .then((r) => r[0])
  return row ?? null
}
