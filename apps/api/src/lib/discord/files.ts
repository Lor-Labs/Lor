import { PutObjectCommand } from "@aws-sdk/client-s3"
import type { Attachment } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { uploadContentDisposition } from "@repo/realtime-types/uploads"
import { logger } from "@/lib/logger"
import { s3Client } from "@/lib/s3"

// Files people post in a Discord place, copied into Lor's storage
// (reference/agents-and-chats.md, decision 51): the agents in it see them as
// attachments (a screenshot of a bug), and the copy outlives Discord's file
// links, which expire after about a day.

export type DiscordAttachment = {
  url: string
  filename: string
  size?: number
  content_type?: string
  width?: number | null
  height?: number | null
}

const MAX_FILES = 10
const MAX_BYTES = 25 * 1024 * 1024

export async function copyDiscordFiles(
  channelId: string,
  files: DiscordAttachment[]
): Promise<{ attachments: Attachment[]; failed: DiscordAttachment[] }> {
  const attachments: Attachment[] = []
  const failed: DiscordAttachment[] = []
  for (const file of files.slice(0, MAX_FILES)) {
    if ((file.size ?? 0) > MAX_BYTES) {
      failed.push(file)
      continue
    }
    try {
      const res = await fetch(file.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = Buffer.from(await res.arrayBuffer())
      const contentType =
        file.content_type ??
        res.headers.get("content-type") ??
        "application/octet-stream"
      const name = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "file"
      const key = `attachments/${channelId}/discord/${crypto.randomUUID()}/${name}`
      await s3Client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentDisposition: uploadContentDisposition(contentType),
        })
      )
      attachments.push({
        url: `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`,
        filename: file.filename,
        size: body.byteLength,
        contentType,
        ...(file.width ? { width: file.width } : {}),
        ...(file.height ? { height: file.height } : {}),
      })
    } catch (err) {
      logger.warn({ err, filename: file.filename }, "Discord file copy failed")
      failed.push(file)
    }
  }
  return { attachments, failed: [...failed, ...files.slice(MAX_FILES)] }
}
