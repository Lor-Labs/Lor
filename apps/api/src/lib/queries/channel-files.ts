import { z } from "@hono/zod-openapi"
import { db, sql } from "@repo/db"
import { env } from "@repo/env/server"

export const fileCursorSchema = z.object({
  at: z.string().datetime(),
  id: z.string().min(1).max(100),
})

type Conversation = { messageId: string; threadRootId: string | null }

// Old artifacts have no originRunId. Recover their source from persisted
// tool results, with all lookups confined to the already-authorized channel.
export async function artifactConversations(channelId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, Conversation>()
  const rows = await db.execute<{
    artifactId: string
    messageId: string | null
    threadRootId: string | null
  }>(sql`
    select a.id as "artifactId",
      coalesce(source.id, legacy.id) as "messageId",
      coalesce(source.thread_root_id, legacy.thread_root_id) as "threadRootId"
    from artifact a
    left join plan p on p.id = a.plan_id and p.channel_id = a.channel_id
    left join agent_run r on r.id = a.origin_run_id and r.channel_id = a.channel_id
    left join message source on source.id = coalesce(p.thread_root_id, r.message_id, r.trigger_message_id)
      and source.channel_id = a.channel_id
    left join lateral (
      select m.id, m.thread_root_id from message m
      where source.id is null and m.channel_id = a.channel_id
        and m.lor_tool_calls @> jsonb_build_array(jsonb_build_object(
          'files', jsonb_build_array(jsonb_build_object('artifactId', a.id::text))))
      order by m.created_at asc, m.id asc limit 1
    ) legacy on true
    where a.channel_id = ${channelId}::uuid
      and a.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
  `)
  const result = new Map<string, Conversation>()
  for (const row of rows) {
    if (row.messageId)
      result.set(row.artifactId, {
        messageId: row.messageId,
        threadRootId: row.threadRootId,
      })
  }
  return result
}

type FileRow = {
  id: string
  kind: "artifact" | "upload"
  artifactId: string | null
  name: string
  contentType: string
  size: number | null
  url: string
  version: number | null
  authorName: string
  updatedAt: string
  messageId: string | null
  threadRootId: string | null
}

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
  const rows = await db.execute<FileRow>(sql`
    with files as (
      select 'artifact:' || a.id::text as id, 'artifact' as kind,
        a.id as "artifactId", a.path as name, v.content_type as "contentType",
        v.size, ${`${env.S3_PUBLIC_URL}/`} || v.blob_key as url,
        v.version, case when v.author_type = 'agent' then 'Lor'
          else coalesce(u.name, 'Former member') end as "authorName",
        a.updated_at as sort_at, null::uuid as "messageId", null::uuid as "threadRootId"
      from artifact a
      join artifact_version v on v.artifact_id = a.id and v.version = a.current_version
      left join "user" u on u.id = v.author_id
      where a.channel_id = ${channelId}::uuid and a.workspace_id = ${workspaceId}::uuid
        and ${kind !== "upload"}
      union all
      select 'upload:' || m.id::text || ':' || f.ordinality::text, 'upload',
        null::uuid, f.value->>'filename', coalesce(f.value->>'contentType', 'application/octet-stream'),
        (f.value->>'size')::integer, f.value->>'url', null::integer,
        coalesce(m.override_name, u.name), m.created_at, m.id, m.thread_root_id
      from message m
      join "user" u on u.id = m.author_id
      cross join lateral jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) with ordinality f
      where m.channel_id = ${channelId}::uuid
        and ${kind !== "artifact"}
    )
    select id, kind, "artifactId", name, "contentType", size, url, version,
      "authorName", "messageId", "threadRootId",
      to_char(sort_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
    from files
    where ${q ? sql`name ilike ${pattern}` : sql`true`}
      and ${cursor ? sql`(sort_at, id) < (${cursor.at}::timestamp, ${cursor.id})` : sql`true`}
    order by sort_at desc, id desc
    limit ${limit + 1}
  `)
  const page = rows.slice(0, limit)
  const origins = await artifactConversations(
    channelId,
    page.flatMap((file) => (file.artifactId ? [file.artifactId] : []))
  )
  const last = page.at(-1)
  return {
    files: page.map(({ messageId, threadRootId, ...file }) => ({
      ...file,
      conversation: file.artifactId
        ? (origins.get(file.artifactId) ?? null)
        : messageId
          ? { messageId, threadRootId }
          : null,
    })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.updatedAt, id: last.id })
          ).toString("base64url")
        : null,
  }
}
