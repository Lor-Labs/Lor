import { and, asc, db, eq, gte, lte, schema, sql } from "@repo/db"
import { privateAudienceFilter } from "../retrieval"
import { documentKind, pieceLabel } from "./kinds"

const MAX_PIECES = 10
const MAX_CHARS = 20_000

// Stored pieces of one attachment, for read_attachment. The caller has
// already checked the url against the run's audience (findWorkspaceAttachment).
export async function readAttachmentPieces(
  workspaceId: string,
  url: string,
  privateContainerChannelId: string | null,
  from?: number,
  to?: number
) {
  const scope = and(
    eq(schema.attachmentChunk.workspaceId, workspaceId),
    eq(schema.attachmentChunk.url, url),
    eq(schema.message.excludedFromMemory, false),
    privateAudienceFilter(privateContainerChannelId)
  )
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      first: sql<number>`min(${schema.attachmentChunk.position})`,
      last: sql<number>`max(${schema.attachmentChunk.position})`,
      truncated: sql<boolean>`bool_or(${schema.attachmentChunk.truncated})`,
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
    .where(scope)
  if (!summary || summary.count === 0) return null

  const start = Math.max(from ?? summary.first, summary.first)
  const end = Math.min(to ?? start + MAX_PIECES - 1, start + MAX_PIECES - 1)
  const rows = await db
    .select({
      position: schema.attachmentChunk.position,
      text: schema.attachmentChunk.text,
      filename: schema.attachmentChunk.filename,
      contentType: schema.attachmentChunk.contentType,
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
    .where(
      and(
        scope,
        gte(schema.attachmentChunk.position, start),
        lte(schema.attachmentChunk.position, end)
      )
    )
    .orderBy(asc(schema.attachmentChunk.position))
    .limit(MAX_PIECES)

  if (rows.length === 0) {
    return {
      indexedPieces: summary.count,
      pieces: [],
      note: `nothing indexed in that range; this file's pieces run from ${summary.first} to ${summary.last}`,
    }
  }

  const pieces: { location: string; text: string }[] = []
  let chars = 0
  let nextFrom: number | null = null
  for (const row of rows) {
    if (pieces.length > 0 && chars + row.text.length > MAX_CHARS) {
      nextFrom = row.position
      break
    }
    const text = row.text.slice(0, MAX_CHARS)
    chars += text.length
    pieces.push({
      location:
        pieceLabel(row.contentType, row.filename, row.position) ?? "whole file",
      text: text.length < row.text.length ? `${text}\n[…cut]` : text,
    })
  }
  const lastRead = rows[pieces.length - 1]?.position ?? start
  if (nextFrom === null && lastRead < summary.last) nextFrom = lastRead + 1

  const first = rows[0]
  const kind = first ? documentKind(first.contentType, first.filename) : null
  const notes = [
    kind === "xlsx" || kind === "csv"
      ? "Spreadsheet rows are not stored: each piece profiles one sheet (columns, ranges, frequent values, sample rows). For exact totals or filtered rows, use create_artifacts with this url."
      : null,
    summary.truncated
      ? "Only part of this file was indexed (it exceeded the indexing limits). For the full file, use create_artifacts with this url."
      : null,
  ].filter(Boolean)

  return {
    filename: first?.filename ?? null,
    indexedPieces: summary.count,
    pieces,
    ...(nextFrom !== null ? { nextFrom } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  }
}
