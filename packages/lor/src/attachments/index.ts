import { createHash } from "node:crypto"
import { and, db, eq, schema } from "@repo/db"
import type { Attachment, NewAttachmentChunk } from "@repo/db/schema"
import sharp from "sharp"
import { embedDocumentWithUsage } from "../embeddings"
import {
  type FetchedImage,
  fetchImageBytes,
  isViewableImage,
  MAX_IMAGE_BYTES,
} from "../images"
import { logger } from "../logger"
import { emitUsage, type OnUsage } from "../usage"
import { transcribeImage } from "./transcribe"

const MIN_IMAGE_EDGE_PX = 128
const DOWNSCALE_EDGE_PX = 3072
const EMBED_INPUT_MAX_CHARS = 16_000

type IndexTarget = {
  workspaceId: string
  channelId: string
  messageId: string
  content: string | null
}

// GIFs and icon-sized images are reactions and decoration, not content.
function isIndexableImage(attachment: Attachment): boolean {
  if (attachment.contentType === "image/gif") return false
  if (!isViewableImage(attachment.contentType)) return false
  const { width, height } = attachment
  return !(width && height && Math.max(width, height) < MIN_IMAGE_EDGE_PX)
}

// Retina screenshots often exceed the vision byte cap; shrink them instead
// of skipping them.
async function fitImage(image: FetchedImage): Promise<FetchedImage | null> {
  if (image.bytes.byteLength <= MAX_IMAGE_BYTES) return image
  const bytes = await sharp(image.bytes)
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

async function indexImage(
  target: IndexTarget,
  attachment: Attachment,
  onUsage?: OnUsage
): Promise<void> {
  const fetched = await fetchImageBytes(attachment.url, attachment.contentType)
  const image = fetched ? await fitImage(fetched) : null
  if (!fetched || !image) throw new Error("image could not be loaded")

  const contentHash = createHash("sha256").update(fetched.bytes).digest("hex")
  // A repost reuses the earlier transcription instead of paying for another.
  const prior = await db
    .select({ text: schema.attachmentChunk.text })
    .from(schema.attachmentChunk)
    .where(
      and(
        eq(schema.attachmentChunk.workspaceId, target.workspaceId),
        eq(schema.attachmentChunk.contentHash, contentHash)
      )
    )
    .limit(1)
    .then((r) => r[0])
  const text =
    prior?.text ??
    (await transcribeImage(
      target.workspaceId,
      image,
      attachment.filename,
      onUsage
    ))

  const embedInput = [attachment.filename, target.content, text]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, EMBED_INPUT_MAX_CHARS)
  const embedding = await embedDocumentWithUsage(embedInput)
    .then((r) => {
      emitUsage(onUsage, {
        workspaceId: target.workspaceId,
        tool: "attachment.embed",
        model: r.model,
        inputTokens: r.tokens,
      })
      return r.embedding
    })
    .catch((err) => {
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
    contentHash,
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
      set: { text, contentHash, ...(embedding ? { embedding } : {}) },
    })
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
    if (indexed.has(attachment.url) || !isIndexableImage(attachment)) continue
    try {
      await indexImage(target, attachment, onUsage)
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
