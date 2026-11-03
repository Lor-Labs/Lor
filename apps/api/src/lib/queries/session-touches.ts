import { db, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { TouchAction, TouchKind } from "@repo/db/schema"
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm"

// What a session's runs read, cited, wrote or were pointed at (the `touch`
// table, reference/planned/session-memory.md Step 5), resolved to titles and
// links for the session's Details panel, with the other sessions that
// touched the same item. The messages it started from are left out: the
// transcript's context fold shows those.

const TOUCHES_MAX = 200
const OTHER_ROWS_MAX = 2000
const OTHER_SESSIONS_SHOWN = 3
const PREVIEW_CHARS = 280
// Canonical 8-4-4-4-12 form only: anything else would fail the uuid casts and
// comparisons below and take the whole panel down.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SOURCE_KEYED: ReadonlySet<TouchKind> = new Set([
  "github_pr",
  "github_issue",
  "linear_issue",
  "notion_page",
  "attio_record",
  "attio_list_entry",
  "attio_task",
])

type Resolved = {
  title: string | null
  detail: string | null
  url: string | null
  // Opens in the app: a message, or a call's chat.
  messageId: string | null
  provider: string | null
}

const EMPTY: Resolved = {
  title: null,
  detail: null,
  url: null,
  messageId: null,
  provider: null,
}

function githubUrl(kind: TouchKind, value: string): string | null {
  if (kind === "github_repo") return `https://github.com/${value}`
  const [repo, number] = value.split("#")
  if (!repo || !number) return null
  return `https://github.com/${repo}/${kind === "github_pr" ? "pull" : "issues"}/${number}`
}

async function brainPaths(nodeIds: string[]) {
  if (nodeIds.length === 0) return new Map<string, string>()
  const ids = sql.join(
    nodeIds.map((id) => sql`${id}::uuid`),
    sql`, `
  )
  const rows = await db.execute<{ leaf: string; path: string }>(sql`
    with recursive chain as (
      select id as leaf, parent_id, name, 0 as depth
      from brain_node where id in (${ids})
      union all
      select chain.leaf, node.parent_id, node.name, chain.depth + 1
      from brain_node node join chain on node.id = chain.parent_id
    )
    select leaf, '/' || string_agg(name, '/' order by depth desc) as path
    from chain group by leaf
  `)
  return new Map([...rows].map((row) => [row.leaf, row.path]))
}

export async function fetchSessionTouches(args: {
  sessionId: string
  workspaceId: string
  userId: string
}) {
  const rows = await db
    .select({
      kind: schema.touch.kind,
      value: schema.touch.value,
      action: schema.touch.action,
      createdAt: schema.touch.createdAt,
    })
    .from(schema.touch)
    .where(
      and(
        eq(schema.touch.sessionId, args.sessionId),
        ne(schema.touch.action, "started_from")
      )
    )
    .orderBy(desc(schema.touch.createdAt))
    .limit(TOUCHES_MAX)

  const items = new Map<
    string,
    { kind: TouchKind; value: string; actions: TouchAction[]; at: Date }
  >()
  for (const row of rows) {
    const key = `${row.kind}|${row.value}`
    const item = items.get(key)
    if (!item) {
      items.set(key, {
        kind: row.kind,
        value: row.value,
        actions: [row.action],
        at: row.createdAt,
      })
    } else if (!item.actions.includes(row.action)) {
      item.actions.push(row.action)
    }
  }
  if (items.size === 0) return []

  const valuesOf = (...kinds: TouchKind[]) =>
    [...items.values()]
      .filter((item) => kinds.includes(item.kind))
      .map((item) => item.value)
  const uuidsOf = (...kinds: TouchKind[]) =>
    valuesOf(...kinds).filter((value) => UUID_PATTERN.test(value))

  const accessible = await listAccessibleChannelIds(
    args.userId,
    args.workspaceId
  )
  const sourceKeys = [...items.values()]
    .filter((item) => SOURCE_KEYED.has(item.kind))
    .map((item) => item.value)
  const sourceIds = uuidsOf("source")
  const messageIds = uuidsOf("message")
  const callIds = uuidsOf("call")
  const artifactIds = uuidsOf("artifact")
  const pageIds = uuidsOf("brain_page")

  const [sources, messages, mentions, calls, artifacts, paths, others] =
    await Promise.all([
      sourceKeys.length > 0 || sourceIds.length > 0
        ? db
            .select({
              id: schema.source.id,
              externalId: schema.source.externalId,
              provider: schema.source.provider,
              title: schema.source.title,
              url: schema.source.url,
              state: schema.source.state,
            })
            .from(schema.source)
            .where(
              and(
                eq(schema.source.workspaceId, args.workspaceId),
                or(
                  sourceKeys.length > 0
                    ? inArray(schema.source.externalId, sourceKeys)
                    : undefined,
                  sourceIds.length > 0
                    ? inArray(schema.source.id, sourceIds)
                    : undefined
                )
              )
            )
        : [],
      messageIds.length > 0
        ? db
            .select({
              id: schema.message.id,
              channelId: schema.message.channelId,
              content: schema.message.content,
              authorName: schema.user.name,
              overrideName: schema.message.overrideName,
            })
            .from(schema.message)
            .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
            .where(inArray(schema.message.id, messageIds))
        : [],
      messageIds.length > 0
        ? db
            .select({
              messageId: schema.messageMention.messageId,
              id: schema.user.id,
              name: schema.user.name,
            })
            .from(schema.messageMention)
            .innerJoin(
              schema.user,
              eq(schema.messageMention.mentionedUserId, schema.user.id)
            )
            .where(inArray(schema.messageMention.messageId, messageIds))
        : [],
      callIds.length > 0
        ? db
            .select({
              id: schema.voiceSession.id,
              channelId: schema.voiceSession.channelId,
              threadRootId: schema.voiceSession.threadRootId,
              title: sql<
                string | null
              >`${schema.voiceSession.summary}->>'title'`,
              startedAt: schema.voiceSession.startedAt,
            })
            .from(schema.voiceSession)
            .where(inArray(schema.voiceSession.id, callIds))
        : [],
      artifactIds.length > 0
        ? db
            .select({
              id: schema.artifact.id,
              channelId: schema.artifact.channelId,
              path: schema.artifact.path,
            })
            .from(schema.artifact)
            .where(inArray(schema.artifact.id, artifactIds))
        : [],
      brainPaths(pageIds),
      db
        .select({
          kind: schema.touch.kind,
          value: schema.touch.value,
          sessionId: schema.agentSession.id,
          title: schema.agentSession.title,
          channelId: schema.agentSession.channelId,
          at: sql<Date>`max(${schema.touch.createdAt})`,
        })
        .from(schema.touch)
        .innerJoin(
          schema.agentSession,
          eq(schema.agentSession.id, schema.touch.sessionId)
        )
        .where(
          and(
            eq(schema.touch.workspaceId, args.workspaceId),
            ne(schema.touch.sessionId, args.sessionId),
            or(
              ...[...items.values()].map((item) =>
                and(
                  eq(schema.touch.kind, item.kind),
                  eq(schema.touch.value, item.value)
                )
              )
            )
          )
        )
        .groupBy(
          schema.touch.kind,
          schema.touch.value,
          schema.agentSession.id,
          schema.agentSession.title,
          schema.agentSession.channelId
        )
        .orderBy(desc(sql`max(${schema.touch.createdAt})`))
        .limit(OTHER_ROWS_MAX),
    ])

  const sourceByKey = new Map<string, (typeof sources)[number]>()
  for (const source of sources) {
    sourceByKey.set(source.externalId, source)
    sourceByKey.set(source.id, source)
  }
  const messageById = new Map(
    messages
      .filter((row) => accessible.has(row.channelId))
      .map((row) => [row.id, row])
  )
  const callById = new Map(
    calls
      .filter((row) => accessible.has(row.channelId))
      .map((row) => [row.id, row])
  )
  const artifactById = new Map(
    artifacts
      .filter((row) => accessible.has(row.channelId))
      .map((row) => [row.id, row])
  )
  const othersByKey = new Map<string, { id: string; title: string }[]>()
  for (const row of others) {
    if (!accessible.has(row.channelId)) continue
    const key = `${row.kind}|${row.value}`
    const list = othersByKey.get(key) ?? []
    list.push({ id: row.sessionId, title: row.title })
    othersByKey.set(key, list)
  }

  const resolve = (kind: TouchKind, value: string): Resolved | null => {
    switch (kind) {
      case "github_pr":
      case "github_issue":
      case "github_repo":
      case "linear_issue":
      case "notion_page":
      case "attio_record":
      case "attio_list_entry":
      case "attio_task":
      case "source": {
        const source = sourceByKey.get(value)
        if (kind === "source" && !source) return null
        const fallbackUrl =
          kind === "github_pr" ||
          kind === "github_issue" ||
          kind === "github_repo"
            ? githubUrl(kind, value)
            : kind === "notion_page"
              ? `https://www.notion.so/${value}`
              : null
        return {
          ...EMPTY,
          title: source?.title ?? null,
          detail: source?.state ?? null,
          url: source?.url ?? fallbackUrl,
          provider: source?.provider ?? null,
        }
      }
      case "message": {
        const row = messageById.get(value)
        if (!row) return null
        return {
          ...EMPTY,
          title: row.overrideName ?? row.authorName,
          detail: (row.content ?? "").slice(0, PREVIEW_CHARS),
          messageId: row.id,
        }
      }
      case "call": {
        const row = callById.get(value)
        if (!row) return null
        return {
          ...EMPTY,
          title: row.title,
          detail: row.startedAt.toISOString(),
          messageId: row.threadRootId,
        }
      }
      case "artifact": {
        const row = artifactById.get(value)
        return row ? { ...EMPTY, title: row.path } : null
      }
      case "brain_page": {
        const path = paths.get(value)
        return path ? { ...EMPTY, title: path } : null
      }
      case "url":
        return { ...EMPTY, url: value }
      case "betterstack_incident":
      case "betterstack_error":
        return EMPTY
    }
  }

  const mentionsByMessage = new Map<string, { id: string; name: string }[]>()
  for (const row of mentions) {
    const list = mentionsByMessage.get(row.messageId) ?? []
    list.push({ id: row.id, name: row.name })
    mentionsByMessage.set(row.messageId, list)
  }

  return [...items.values()].flatMap((item) => {
    const resolved = resolve(item.kind, item.value)
    if (!resolved) return []
    const otherSessions = othersByKey.get(`${item.kind}|${item.value}`) ?? []
    return [
      {
        kind: item.kind,
        value: item.value,
        actions: item.actions,
        at: item.at.toISOString(),
        ...resolved,
        mentions:
          item.kind === "message"
            ? (mentionsByMessage.get(item.value) ?? [])
            : [],
        otherSessions: otherSessions.slice(0, OTHER_SESSIONS_SHOWN),
        otherSessionCount: otherSessions.length,
      },
    ]
  })
}
