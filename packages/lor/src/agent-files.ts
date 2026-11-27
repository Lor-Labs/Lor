import { and, db, eq, schema, sql } from "@repo/db"
import type { Attachment } from "@repo/db/schema"
import { env } from "@repo/env/server"

// Files an agent attaches to what it posts (send_message's `files`): a file
// already in the workspace, named by its URL as the agent read it. A file a
// session shared (an artifact: a preview's screenshot or recording) or a
// file someone attached to a message. Anything else is refused, so an agent
// can't post arbitrary URLs as files.
export async function resolveAgentFiles(
  workspaceId: string,
  urls: string[]
): Promise<{ attachments: Attachment[] } | { error: string }> {
  const attachments: Attachment[] = []
  const artifactPrefix = `${env.S3_PUBLIC_URL}/`
  for (const url of [...new Set(urls)]) {
    if (url.startsWith(`${artifactPrefix}artifacts/${workspaceId}/`)) {
      const blobKey = url.slice(artifactPrefix.length)
      const [version] = await db
        .select({
          size: schema.artifactVersion.size,
          contentType: schema.artifactVersion.contentType,
          path: schema.artifact.path,
        })
        .from(schema.artifactVersion)
        .innerJoin(
          schema.artifact,
          eq(schema.artifact.id, schema.artifactVersion.artifactId)
        )
        .where(
          and(
            eq(schema.artifactVersion.blobKey, blobKey),
            eq(schema.artifact.workspaceId, workspaceId)
          )
        )
      if (version) {
        attachments.push({
          url,
          filename: version.path.split("/").at(-1) ?? version.path,
          size: version.size,
          contentType: version.contentType,
        })
        continue
      }
    }
    const [row] = await db
      .select({ attachments: schema.message.attachments })
      .from(schema.message)
      .innerJoin(
        schema.channel,
        eq(schema.channel.id, schema.message.channelId)
      )
      .where(
        and(
          eq(schema.channel.workspaceId, workspaceId),
          sql`${schema.message.attachments} @> ${JSON.stringify([{ url }])}::jsonb`
        )
      )
      .limit(1)
    const found = row?.attachments?.find((file) => file.url === url)
    if (!found) {
      return {
        error: `${url} is not a file in this workspace. Attach files a session shared or that someone posted, by the URL you read.`,
      }
    }
    attachments.push(found)
  }
  return { attachments }
}
