import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { db, eq, schema, sql } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import { canSeeSessionChat } from "@repo/db/queries/session-chat-access"
import type { Attachment } from "@repo/db/schema"
import { env } from "@repo/env/server"

const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
})

export const MAX_ATTACHMENT_DOWNLOAD_BYTES = 32 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Only canonical URLs for this bucket's attachment/artifact namespaces are refs.
export function attachmentObjectKey(rawUrl: string): string | null {
  const prefix = `${env.S3_PUBLIC_URL.replace(/\/+$/, "")}/`
  if (!rawUrl.startsWith(prefix)) return null
  const key = rawUrl.slice(prefix.length)
  const parts = key.split("/")
  const ids =
    parts[0] === "attachments" && parts.length === 4
      ? parts.slice(1, 3)
      : parts[0] === "artifacts" && parts.length === 5
        ? parts.slice(1, 4)
        : null
  if (!ids?.every((id) => UUID.test(id))) return null
  const filename = parts.at(-1) ?? ""
  return /^[a-zA-Z0-9._-]+$/.test(filename) &&
    filename !== "." &&
    filename !== ".."
    ? key
    : null
}

async function canReadSource(
  userId: string,
  source: { channelId: string; threadRootId: string | null }
) {
  const access = await resolveChannelAccess(userId, source.channelId)
  return (
    access.ok &&
    (!source.threadRootId ||
      (await canSeeSessionChat(userId, source.threadRootId)))
  )
}

async function alreadySharedWith(userId: string, url: string, key: string) {
  if (key.startsWith("artifacts/")) {
    const [artifact] = await db
      .select({
        channelId: schema.artifact.channelId,
        threadRootId: schema.artifact.threadRootId,
      })
      .from(schema.artifactVersion)
      .innerJoin(
        schema.artifact,
        eq(schema.artifact.id, schema.artifactVersion.artifactId)
      )
      .where(eq(schema.artifactVersion.blobKey, key))
      .limit(1)
    return artifact ? canReadSource(userId, artifact) : false
  }
  const messages = await db
    .select({
      channelId: schema.message.channelId,
      threadRootId: schema.message.threadRootId,
    })
    .from(schema.message)
    .where(
      sql`${schema.message.attachments} @> ${JSON.stringify([{ url }])}::jsonb`
    )
    .limit(50)
  for (const message of messages) {
    if (await canReadSource(userId, message)) return true
  }
  return false
}

export async function validateMessageAttachments(
  userId: string,
  channelId: string,
  attachments: readonly Attachment[]
): Promise<Attachment[]> {
  const validated: Attachment[] = []
  for (const attachment of attachments) {
    const key = attachmentObjectKey(attachment.url)
    if (!key) throw new Error("Attachments must be uploaded to this workspace")
    const object = await s3.send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) }
    )
    const ownUpload =
      key.startsWith(`attachments/${channelId}/`) &&
      object.Metadata?.["uploader-id"] === userId &&
      object.Metadata?.["channel-id"] === channelId
    if (!ownUpload && !(await alreadySharedWith(userId, attachment.url, key))) {
      throw new Error("Attachment not found or not accessible")
    }
    const size = object.ContentLength
    if (!size || size > env.MAX_FILE_UPLOAD_SIZE || !object.ContentType) {
      throw new Error("Attachment is empty, too large, or has no content type")
    }
    validated.push({ ...attachment, size, contentType: object.ContentType })
  }
  return validated
}

// Read through the configured object store, never through a client-supplied host.
export async function readAttachmentBytes(
  url: string,
  maxBytes = MAX_ATTACHMENT_DOWNLOAD_BYTES
): Promise<Uint8Array> {
  const key = attachmentObjectKey(url)
  if (!key) throw new Error("Invalid attachment storage reference")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: key,
        Range: `bytes=0-${maxBytes}`,
      }),
      { abortSignal: controller.signal }
    )
    const body = object.Body?.transformToWebStream()
    if (!body) throw new Error("Attachment has no body")
    const total = Number(
      object.ContentRange?.split("/").at(-1) ?? object.ContentLength
    )
    if (!Number.isFinite(total) || total > maxBytes) {
      await body.cancel()
      throw new Error("Attachment exceeds the download limit")
    }
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maxBytes)
          throw new Error("Attachment exceeds the download limit")
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    controller.abort()
    clearTimeout(timeout)
  }
}
