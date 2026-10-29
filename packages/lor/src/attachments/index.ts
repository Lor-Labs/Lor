import { and, db, eq, isNull, schema } from "@repo/db"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import type { Attachment, NewAttachmentChunk } from "@repo/db/schema"
import sharp from "sharp"
import { embedDocumentsWithUsage, embedDocumentWithUsage } from "../embeddings"
import {
  type FetchedImage,
  fetchImageBytes,
  isViewableImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from "../images"
import { logger } from "../logger"
import { emitUsage, type OnUsage } from "../usage"
import { type Extracted, extractDocument, type Transcriber } from "./extract"
import { documentKind } from "./kinds"
import {
  attachmentObjectKey,
  MAX_ATTACHMENT_DOWNLOAD_BYTES,
  readAttachmentBytes,
} from "./storage"
import { transcribeImage } from "./transcribe"

const MIN_IMAGE_EDGE_PX = 128
const DOWNSCALE_EDGE_PX = 3072
const EMBED_INPUT_MAX_CHARS = 16_000
const EMBED_BATCH_SIZE = 32
// exceljs loads the whole workbook into memory.
const MAX_SPREADSHEET_BYTES = 25 * 1024 * 1024

type IndexTarget = {
  workspaceId: string
  channelId: string
  messageId: string
  content: string | null
}

// GIFs and icon-sized images are reactions and decoration, not content.
function isDecorativeImage(attachment: Attachment): boolean {
  if (attachment.contentType === "image/gif") return true
  const { width, height } = attachment
  return Boolean(
    attachment.contentType.startsWith("image/") &&
      width &&
      height &&
      Math.max(width, height) < MIN_IMAGE_EDGE_PX
  )
}

// Retina screenshots often exceed the vision byte cap; shrink them instead
// of skipping them.
async function fitImage(image: FetchedImage): Promise<FetchedImage | null> {
  if (image.bytes.byteLength <= MAX_IMAGE_BYTES) return image
  const bytes = await sharp(image.bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
    .resize({
      width: DOWNSCALE_EDGE_PX,
      height: DOWNSCALE_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer()
  return bytes.byteLength <= MAX_IMAGE_BYTES
    ? { bytes: new Uint8Array(bytes), mediaType: "image/jpeg" }
    : null
}

// The filename and the sharing message's text ride along with the chunk text,
// so context like "here's staging" is part of what the vector matches.
function embedInput(parts: (string | null)[]): string {
  return parts.filter(Boolean).join("\n\n").slice(0, EMBED_INPUT_MAX_CHARS)
}

async function embedChunk(
  workspaceId: string,
  parts: (string | null)[],
  onUsage?: OnUsage
): Promise<number[]> {
  const r = await embedDocumentWithUsage(embedInput(parts))
  emitUsage(onUsage, {
    workspaceId,
    tool: "attachment.embed",
    model: r.model,
    inputTokens: r.tokens,
  })
  return r.embedding
}

async function indexImage(
  target: IndexTarget,
  attachment: Attachment,
  onUsage?: OnUsage
): Promise<void> {
  const fetched = await fetchImageBytes(attachment.url, attachment.contentType)
  const image = fetched ? await fitImage(fetched) : null
  if (!image) throw new Error("image could not be loaded")

  const text = await transcribeImage(
    target.workspaceId,
    image,
    attachment.filename,
    onUsage
  )

  const embedding = await embedChunk(
    target.workspaceId,
    [attachment.filename, target.content, text],
    onUsage
  ).catch((err) => {
    logger.warn({ err, url: attachment.url }, "Attachment embed failed")
    return null
  })

  const row: NewAttachmentChunk = {
    ...target,
    url: attachment.url,
    filename: attachment.filename,
    contentType: attachment.contentType,
    position: 0,
    text,
    embedding,
  }
  await db
    .insert(schema.attachmentChunk)
    .values(row)
    .onConflictDoUpdate({
      target: [
        schema.attachmentChunk.messageId,
        schema.attachmentChunk.url,
        schema.attachmentChunk.position,
      ],
      set: { text, ...(embedding ? { embedding } : {}) },
    })
}

// A failed batch leaves null vectors; embedPendingChunks fills them later.
async function embedChunks(
  workspaceId: string,
  inputs: string[],
  onUsage?: OnUsage
): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = []
  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBED_BATCH_SIZE)
    try {
      const r = await embedDocumentsWithUsage(batch)
      emitUsage(onUsage, {
        workspaceId,
        tool: "attachment.embed",
        model: r.model,
        inputTokens: r.tokens,
      })
      out.push(...r.embeddings)
    } catch (err) {
      logger.warn({ err }, "Attachment embed batch failed")
      out.push(...batch.map(() => null))
    }
  }
  return out
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Documents get one row per page, slide, or part. Unsupported types, files
// past the size cap, and files with no extractable text get one filename-only
// row so they are still findable by name and by the sharing message.
async function indexFile(
  target: IndexTarget,
  attachment: Attachment,
  onUsage?: OnUsage
): Promise<void> {
  const kind = documentKind(attachment.contentType, attachment.filename)
  const maxBytes =
    kind === "xlsx" ? MAX_SPREADSHEET_BYTES : MAX_ATTACHMENT_DOWNLOAD_BYTES
  const tooBig = attachment.size > maxBytes
  let extracted: Extracted | null = null
  if (kind && !tooBig) {
    const bytes = await readAttachmentBytes(attachment.url, maxBytes)
    // A page the model fails to read is skipped, not retried: the rest of
    // the document is still indexed.
    const transcribe: Transcriber = async (image) => {
      const fitted = await fitImage(image)
      if (!fitted) return null
      return transcribeImage(
        target.workspaceId,
        fitted,
        attachment.filename,
        onUsage
      ).catch((err) => {
        logger.warn({ err, url: attachment.url }, "Page transcription failed")
        return null
      })
    }
    // Parse failures (encrypted or corrupt files) are permanent; retrying
    // would not help.
    extracted = await extractDocument(bytes, kind, transcribe).catch((err) => {
      logger.warn({ err, url: attachment.url }, "Document extraction failed")
      return null
    })
  }
  const pieces = extracted?.pieces.length
    ? extracted.pieces
    : [
        {
          position: 0,
          text: `File: ${attachment.filename} (${attachment.contentType}, ${formatBytes(attachment.size)})`,
        },
      ]
  const truncated = extracted?.truncated ?? tooBig

  const embeddings = await embedChunks(
    target.workspaceId,
    pieces.map((p) =>
      embedInput([attachment.filename, target.content, p.text])
    ),
    onUsage
  )
  const rows: NewAttachmentChunk[] = pieces.map((piece, i) => ({
    ...target,
    url: attachment.url,
    filename: attachment.filename,
    contentType: attachment.contentType,
    position: piece.position,
    text: piece.text,
    embedding: embeddings[i] ?? null,
    truncated,
  }))
  await db.insert(schema.attachmentChunk).values(rows).onConflictDoNothing()
}

export async function indexMessageAttachments(
  messageId: string,
  onUsage?: OnUsage
): Promise<void> {
  const message = await db
    .select({
      content: schema.message.content,
      attachments: schema.message.attachments,
      excludedFromMemory: schema.message.excludedFromMemory,
      channelId: schema.message.channelId,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .where(eq(schema.message.id, messageId))
    .limit(1)
    .then((r) => r[0])
  // DMs (no workspace) are never indexed: they will be E2E encrypted.
  if (!message?.workspaceId || message.excludedFromMemory) return
  if ((await workspaceBetaAccess(message.workspaceId)).state !== "active")
    return
  if (!message.attachments?.length) return

  const target: IndexTarget = {
    workspaceId: message.workspaceId,
    channelId: message.channelId,
    messageId,
    content: message.content,
  }
  const indexed = await db
    .select({ url: schema.attachmentChunk.url })
    .from(schema.attachmentChunk)
    .where(eq(schema.attachmentChunk.messageId, messageId))
    .then((rows) => new Set(rows.map((r) => r.url)))

  let failed = 0
  for (const attachment of message.attachments) {
    if (!attachmentObjectKey(attachment.url)) continue
    if (indexed.has(attachment.url) || isDecorativeImage(attachment)) continue
    try {
      if (isViewableImage(attachment.contentType)) {
        await indexImage(target, attachment, onUsage)
      } else {
        await indexFile(target, attachment, onUsage)
      }
    } catch (err) {
      failed++
      logger.warn(
        { err, messageId, url: attachment.url },
        "Attachment indexing failed"
      )
    }
  }
  // Throw so the queue retries; attachments indexed on this attempt are
  // skipped on the next one.
  if (failed > 0) throw new Error(`${failed} attachment(s) failed to index`)
}

// Rows saved without a vector (the embed call failed at index time).
export async function embedPendingChunks(
  workspaceId: string | null,
  onUsage?: OnUsage
): Promise<{ embedded: number; failed: number }> {
  const rows = await db
    .select({
      id: schema.attachmentChunk.id,
      workspaceId: schema.attachmentChunk.workspaceId,
      filename: schema.attachmentChunk.filename,
      text: schema.attachmentChunk.text,
      content: schema.message.content,
    })
    .from(schema.attachmentChunk)
    .innerJoin(
      schema.message,
      eq(schema.attachmentChunk.messageId, schema.message.id)
    )
    .where(
      and(
        isNull(schema.attachmentChunk.embedding),
        workspaceId
          ? eq(schema.attachmentChunk.workspaceId, workspaceId)
          : undefined
      )
    )
  let embedded = 0
  let failed = 0
  for (const row of rows) {
    if ((await workspaceBetaAccess(row.workspaceId)).state !== "active")
      continue
    try {
      const embedding = await embedChunk(
        row.workspaceId,
        [row.filename, row.content, row.text],
        onUsage
      )
      await db
        .update(schema.attachmentChunk)
        .set({ embedding })
        .where(eq(schema.attachmentChunk.id, row.id))
      embedded++
    } catch (err) {
      failed++
      logger.warn({ err, chunkId: row.id }, "Attachment chunk embed failed")
    }
  }
  return { embedded, failed }
}
