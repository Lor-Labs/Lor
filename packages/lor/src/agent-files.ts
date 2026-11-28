import { and, db, eq, inArray, schema, sql } from "@repo/db"
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Session links in an agent's post render as inline session chips in the web
// chat (message-markdown.tsx). Each must be one of this workspace's sessions,
// so the agent can't post a dead or foreign session link.
export async function checkSessionLinks(
  workspaceId: string,
  content: string
): Promise<{ error: string } | null> {
  const base = env.APP_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(
    `${base}/([\\w-]+)/session/([^/?#)\\s>\\]]+)`,
    "gi"
  )
  const links = [...content.matchAll(pattern)].map((match) => ({
    slug: decodeURIComponent(match[1] ?? ""),
    id: (match[2] ?? "").toLowerCase(),
  }))
  if (links.length === 0) return null
  const [workspace] = await db
    .select({ slug: schema.workspace.slug })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
  const ids = [...new Set(links.map((link) => link.id))].filter((id) =>
    UUID_RE.test(id)
  )
  const found = ids.length
    ? await db
        .select({ id: schema.agentSession.id })
        .from(schema.agentSession)
        .where(
          and(
            eq(schema.agentSession.workspaceId, workspaceId),
            inArray(schema.agentSession.id, ids)
          )
        )
    : []
  const bad = links.filter(
    (link) =>
      link.slug !== workspace?.slug || !found.some((row) => row.id === link.id)
  )
  if (bad.length === 0) return null
  return {
    error: `Not a session in this workspace: ${[...new Set(bad.map((link) => link.id))].join(", ")}. Link sessions by the link start_session or check_session returned.`,
  }
}
