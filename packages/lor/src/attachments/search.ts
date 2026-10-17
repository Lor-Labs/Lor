import { and, cosineDistance, db, eq, isNotNull, schema, sql } from "@repo/db"
import { outsideLiveSessionChatFilter } from "@repo/db/queries/session-chat-access"
import { embedAttachmentQuery } from "../embeddings"
import {
  bm25Score,
  type DbTransaction,
  fuseByRank,
  orTsQuery,
  privateAudienceFilter,
  userDisplayName,
  withIterativeScan,
} from "../retrieval"
import { pieceLabel } from "./kinds"

const POOL_FACTOR = 3
const SNIPPET_MAX = 1000
// A long PDF or a big workbook would otherwise fill every result slot.
const MAX_HITS_PER_FILE = 2

// Must match the attachment_chunk_text_tsv_idx and _bm25_idx expressions.
const chunkText = sql`translate(${schema.attachmentChunk.filename}, '._-', '   ') || ' ' || ${schema.attachmentChunk.text}`
const chunkTsv = sql`to_tsvector('english', ${chunkText})`

function candidates(executor: Pick<DbTransaction, "select"> = db) {
  return executor
    .select({
      id: schema.attachmentChunk.id,
      messageId: schema.attachmentChunk.messageId,
      channelId: schema.attachmentChunk.channelId,
      url: schema.attachmentChunk.url,
      filename: schema.attachmentChunk.filename,
      contentType: schema.attachmentChunk.contentType,
      position: schema.attachmentChunk.position,
      truncated: schema.attachmentChunk.truncated,
      text: schema.attachmentChunk.text,
      createdAt: schema.message.createdAt,
      authorName: schema.user.name,
    })
    .from(schema.attachmentChunk)
    .innerJoin(
      schema.message,
      eq(schema.attachmentChunk.messageId, schema.message.id)
    )
    .innerJoin(
      schema.channel,
      eq(schema.attachmentChunk.channelId, schema.channel.id)
    )
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .$dynamic()
}

type Candidate = Awaited<ReturnType<typeof candidates>>[number]

// Keyword and vector results rank independently, then merge by reciprocal
// rank fusion: exact values (instance types, IDs) come from the keyword side,
// paraphrases from the vector side.
export async function searchAttachments(
  workspaceId: string,
  query: string,
  limit: number,
  privateContainerChannelId: string | null = null
) {
  const pool = limit * POOL_FACTOR
  const scope = and(
    eq(schema.attachmentChunk.workspaceId, workspaceId),
    eq(schema.message.excludedFromMemory, false),
    privateAudienceFilter(privateContainerChannelId),
    outsideLiveSessionChatFilter(schema.message.threadRootId)
  )
  const tsq = orTsQuery(query)

  const [keyword, vector] = await Promise.all([
    candidates()
      .where(and(scope, sql`${chunkTsv} @@ ${tsq}`))
      .orderBy(
        bm25Score(
          sql`(${chunkText})`,
          query,
          schema.ATTACHMENT_CHUNK_BM25_INDEX
        )
      )
      .limit(pool),
    embedAttachmentQuery(query)
      .then((embedding) =>
        withIterativeScan((tx) =>
          candidates(tx)
            .where(and(scope, isNotNull(schema.attachmentChunk.embedding)))
            .orderBy(
              cosineDistance(schema.attachmentChunk.embedding, embedding)
            )
            .limit(pool)
        )
      )
      .catch(() => [] as Candidate[]),
  ])

  const perFile = new Map<string, number>()
  return fuseByRank([keyword, vector], (row) => row.id)
    .filter((row) => {
      const key = `${row.messageId}:${row.url}`
      const hits = perFile.get(key) ?? 0
      perFile.set(key, hits + 1)
      return hits < MAX_HITS_PER_FILE
    })
    .slice(0, limit)
    .map((row) => ({
      messageId: row.messageId,
      channelId: row.channelId,
      url: row.url,
      filename: row.filename,
      contentType: row.contentType,
      location: pieceLabel(row.contentType, row.filename, row.position),
      truncated: row.truncated,
      author: userDisplayName({ name: row.authorName }),
      when: row.createdAt.toISOString(),
      text: row.text.slice(0, SNIPPET_MAX),
    }))
}
