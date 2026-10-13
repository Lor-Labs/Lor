import { z } from "@hono/zod-openapi"
import {
  and,
  asc,
  type Column,
  db,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  type SQL,
  sql,
} from "@repo/db"
import {
  type Attachment,
  agentRun,
  agentSession,
  artifact,
  artifactVersion,
  message,
  plan,
  user,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { alias } from "drizzle-orm/pg-core"

export const fileCursorSchema = z.object({
  at: z.string().datetime(),
  id: z.string().min(1).max(100),
})

type Conversation = {
  messageId: string
  threadRootId: string | null
  sessionId: string | null
}

// Old artifacts have no originRunId. Recover their source from persisted
// tool results, with all lookups confined to the already-authorized channel.
export async function artifactConversations(channelId: string, ids: string[]) {
  const result = new Map<string, Conversation>()
  if (ids.length === 0) return result
  const source = alias(message, "source")
  const legacyMessage = alias(message, "legacy_message")
  const legacy = db
    .select({ id: legacyMessage.id, threadRootId: legacyMessage.threadRootId })
    .from(legacyMessage)
    .where(
      and(
        isNull(source.id),
        eq(legacyMessage.channelId, artifact.channelId),
        sql`${legacyMessage.lorToolCalls} @> jsonb_build_array(jsonb_build_object(
          'files', jsonb_build_array(jsonb_build_object('artifactId', ${artifact.id}::text))))`
      )
    )
    .orderBy(asc(legacyMessage.createdAt), asc(legacyMessage.id))
    .limit(1)
    .as("legacy")
  const rows = await db
    .select({
      artifactId: artifact.id,
      messageId: sql<string | null>`coalesce(${source.id}, ${legacy.id})`,
      threadRootId: sql<
        string | null
      >`coalesce(${source.threadRootId}, ${legacy.threadRootId})`,
      sessionId: agentSession.id,
    })
    .from(artifact)
    .leftJoin(
      plan,
      and(eq(plan.id, artifact.planId), eq(plan.channelId, artifact.channelId))
    )
    .leftJoin(
      agentRun,
      and(
        eq(agentRun.id, artifact.originRunId),
        eq(agentRun.channelId, artifact.channelId)
      )
    )
    .leftJoin(
      source,
      and(
        eq(
          source.id,
          sql`coalesce(${plan.threadRootId}, ${agentRun.messageId}, ${agentRun.triggerMessageId})`
        ),
        eq(source.channelId, artifact.channelId)
      )
    )
    .leftJoinLateral(legacy, sql`true`)
    .leftJoin(
      agentSession,
      eq(
        agentSession.threadRootId,
        sql`coalesce(${source.threadRootId}, ${legacy.threadRootId}, ${source.id}, ${legacy.id})`
      )
    )
    .where(and(eq(artifact.channelId, channelId), inArray(artifact.id, ids)))
  for (const row of rows) {
    if (row.messageId)
      result.set(row.artifactId, {
        messageId: row.messageId,
        threadRootId: row.threadRootId,
        sessionId: row.sessionId,
      })
  }
  return result
}

// Microseconds: a millisecond cursor would skip rows that share one.
const cursorTime = (column: Column) =>
  sql<string>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

// An upload is one element of message.attachments, exploded as `f` below.
const attachmentField = (key: keyof Attachment) =>
  sql<string>`f.value->>${sql.raw(`'${key}'`)}`

export async function fetchChannelFiles(args: {
  channelId: string
  workspaceId: string | null
  q: string
  kind: "all" | "artifact" | "upload"
  limit: number
  cursor: z.infer<typeof fileCursorSchema> | null
}) {
  const { channelId, workspaceId, q, kind, limit, cursor } = args
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  // Each query filters, orders and limits on its own index (the message one
  // stops early on message_channelId_createdAt_idx); the page merges them.
  const olderThanCursor = (sortAt: Column, id: SQL) =>
    cursor
      ? sql`(${sortAt}, ${id}) < (${cursor.at}::timestamp, ${cursor.id})`
      : undefined
  const artifactFileId = sql<string>`'artifact:' || ${artifact.id}::text`
  const uploadFileId = sql<string>`'upload:' || ${message.id}::text || ':' || f.ordinality::text`
  const uploadName = attachmentField("filename")

  const [artifactRows, uploadRows] = await Promise.all([
    db
      .select({
        id: artifactFileId,
        artifactId: artifact.id,
        name: artifact.path,
        contentType: artifactVersion.contentType,
        size: artifactVersion.size,
        blobKey: artifactVersion.blobKey,
        version: artifactVersion.version,
        authorType: artifactVersion.authorType,
        authorName: user.name,
        updatedAt: cursorTime(artifact.updatedAt),
      })
      .from(artifact)
      .innerJoin(
        artifactVersion,
        and(
          eq(artifactVersion.artifactId, artifact.id),
          eq(artifactVersion.version, artifact.currentVersion)
        )
      )
      .leftJoin(user, eq(user.id, artifactVersion.authorId))
      .where(
        and(
          kind === "upload" ? sql`false` : undefined,
          eq(artifact.channelId, channelId),
          workspaceId ? eq(artifact.workspaceId, workspaceId) : sql`false`,
          q ? ilike(artifact.path, pattern) : undefined,
          olderThanCursor(artifact.updatedAt, artifactFileId)
        )
      )
      .orderBy(desc(artifact.updatedAt), desc(artifactFileId))
      .limit(limit + 1),
    db
      .select({
        id: uploadFileId,
        name: uploadName,
        contentType: sql<string>`coalesce(${attachmentField("contentType")}, 'application/octet-stream')`,
        size: sql<number | null>`(${attachmentField("size")})::integer`,
        url: attachmentField("url"),
        attachmentIndex: sql<number>`(f.ordinality - 1)::integer`,
        overrideName: message.overrideName,
        authorName: user.name,
        updatedAt: cursorTime(message.createdAt),
        messageId: message.id,
        threadRootId: message.threadRootId,
        sessionId: agentSession.id,
      })
      .from(message)
      .innerJoin(user, eq(user.id, message.authorId))
      .leftJoin(
        agentSession,
        eq(
          agentSession.threadRootId,
          sql`coalesce(${message.threadRootId}, ${message.id})`
        )
      )
      .crossJoinLateral(
        sql`jsonb_array_elements(coalesce(${message.attachments}, '[]'::jsonb)) with ordinality f`
      )
      .where(
        and(
          kind === "artifact" ? sql`false` : undefined,
          eq(message.channelId, channelId),
          q ? ilike(uploadName, pattern) : undefined,
          olderThanCursor(message.createdAt, uploadFileId)
        )
      )
      .orderBy(desc(message.createdAt), desc(uploadFileId))
      .limit(limit + 1),
  ])

  const uploads = uploadRows.map((row) => ({
    id: row.id,
    kind: "upload" as const,
    artifactId: null,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    url: row.url,
    version: null,
    attachmentIndex: row.attachmentIndex,
    authorName: row.overrideName ?? row.authorName,
    updatedAt: row.updatedAt,
    conversation: {
      messageId: row.messageId,
      threadRootId: row.threadRootId,
      sessionId: row.sessionId,
    },
  }))
  const artifacts = artifactRows.map((row) => ({
    id: row.id,
    kind: "artifact" as const,
    artifactId: row.artifactId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    url: `${env.S3_PUBLIC_URL}/${row.blobKey}`,
    version: row.version,
    attachmentIndex: null,
    authorName:
      row.authorType === "agent" ? "Lor" : (row.authorName ?? "Former member"),
    updatedAt: row.updatedAt,
    conversation: null,
  }))
  // Stable sort: equal timestamps keep each query's order with uploads first,
  // the same (updatedAt, id) desc order the cursor pages by.
  const merged = [...uploads, ...artifacts].sort((a, b) =>
    a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1
  )
  const page = merged.slice(0, limit)
  const origins = await artifactConversations(
    channelId,
    page.flatMap((file) => (file.artifactId ? [file.artifactId] : []))
  )
  const last = page.at(-1)
  return {
    files: page.map((file) =>
      file.artifactId
        ? { ...file, conversation: origins.get(file.artifactId) ?? null }
        : file
    ),
    nextCursor:
      merged.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.updatedAt, id: last.id })
          ).toString("base64url")
        : null,
  }
}
