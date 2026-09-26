import { and, cosineDistance, db, eq, isNotNull, schema, sql } from "@repo/db"
import { embedAttachmentQuery } from "../embeddings"
import { orTsQuery, privateAudienceFilter, userDisplayName } from "../retrieval"
import { pieceLabel } from "./kinds"

const POOL_FACTOR = 3
const RRF_K = 60
const SNIPPET_MAX = 1000

// Must match the attachment_chunk_text_tsv_idx expression exactly.
const chunkTsv = sql`to_tsvector('english', translate(${schema.attachmentChunk.filename}, '._-', '   ') || ' ' || ${schema.attachmentChunk.text})`

function candidates() {
  return db
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
    privateAudienceFilter(privateContainerChannelId)
  )
  const tsq = orTsQuery(query)

  const [keyword, vector] = await Promise.all([
    candidates()
      .where(and(scope, sql`${chunkTsv} @@ ${tsq}`))
      .orderBy(sql`ts_rank(${chunkTsv}, ${tsq}) desc`)
      .limit(pool),
    embedAttachmentQuery(query)
      .then((embedding) =>
        candidates()
          .where(and(scope, isNotNull(schema.attachmentChunk.embedding)))
          .orderBy(cosineDistance(schema.attachmentChunk.embedding, embedding))
          .limit(pool)
      )
      .catch(() => [] as Candidate[]),
  ])

  const scored = new Map<string, { row: Candidate; score: number }>()
  for (const list of [keyword, vector]) {
    list.forEach((row, rank) => {
      const entry = scored.get(row.id) ?? { row, score: 0 }
      entry.score += 1 / (RRF_K + rank + 1)
      scored.set(row.id, entry)
    })
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
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
