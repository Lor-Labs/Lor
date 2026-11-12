import { randomBytes } from "node:crypto"
import { and, db, eq, inArray, notInArray, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import {
  type BrowserAnnotation,
  cleanBrowserAnnotation,
  endPreviewViews,
  readBrowserAnnotations,
} from "@repo/lor/dev-env/browser"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Preview links for a code session's browser
// (reference/planned/sandbox-browser-runbook.md §8): who a link lets in and
// what they may do, the annotations' copy in the database, and whether
// someone signed in is watching (a public link's signed-out visitors never
// wake the sandbox on their own).

export const PREVIEW_LINK_DAYS = 7
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A signed-in viewer's page says it is open every minute.
const SEEN_TTL_SECONDS = 150

export const newPreviewToken = () => randomBytes(24).toString("base64url")

export const previewExpiry = () =>
  new Date(Date.now() + PREVIEW_LINK_DAYS * 24 * 60 * 60_000)

// A link that still opens: not expired, on a code session that isn't
// archived.
export async function findPreviewLink(token: string) {
  const row = await db
    .select({
      link: schema.sessionPreviewLink,
      session: schema.agentSession,
      workspaceName: schema.workspace.name,
      workspaceSlug: schema.workspace.slug,
    })
    .from(schema.sessionPreviewLink)
    .innerJoin(
      schema.agentSession,
      eq(schema.sessionPreviewLink.sessionId, schema.agentSession.id)
    )
    .innerJoin(
      schema.workspace,
      eq(schema.agentSession.workspaceId, schema.workspace.id)
    )
    .where(eq(schema.sessionPreviewLink.token, token))
    .limit(1)
    .then((rows) => rows[0])
  if (!row || row.link.expiresAt.getTime() < Date.now()) return null
  if (row.session.mode !== "code" || row.session.archivedAt) return null
  return row
}

export type PreviewLink = NonNullable<
  Awaited<ReturnType<typeof findPreviewLink>>
>

// `watch`: sees the screen, the pointers and the notes. `annotate`: also
// points and leaves notes. `control`: may also take the browser's mouse and
// keyboard, like anyone who can write in the session's channel.
export type PreviewAccess =
  | { status: "sign_in_required" }
  | { status: "no_access" }
  | {
      status: "ready"
      member: boolean
      annotate: boolean
      control: boolean
    }

// Private: people in the session's workspace. Public: anyone watches, and
// any signed-in Lor account points and annotates.
export async function previewAccess(
  { link, session }: PreviewLink,
  userId: string | null
): Promise<PreviewAccess> {
  if (!userId) {
    return link.access === "public"
      ? { status: "ready", member: false, annotate: false, control: false }
      : { status: "sign_in_required" }
  }
  const member = await db
    .select({ id: schema.workspaceMember.id })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, session.workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows.length > 0)
  if (!member && link.access === "private") return { status: "no_access" }
  const channel = member
    ? await resolveChannelAccess(userId, session.channelId)
    : null
  return {
    status: "ready",
    member,
    annotate: true,
    control: channel?.ok === true && channel.access.canWrite,
  }
}

const seenKey = (sessionId: string) => `browser:seen:${sessionId}`

export async function markBrowserSeen(sessionId: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.set(seenKey(sessionId), "1", { EX: SEEN_TTL_SECONDS })
  } catch (err) {
    logger.warn({ err, sessionId }, "Couldn't record the browser viewer")
  }
}

// Fails closed: without Redis a signed-out visitor waits rather than wakes
// a sandbox.
export async function browserSeenRecently(sessionId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient()
    return (await redis.exists(seenKey(sessionId))) === 1
  } catch {
    return false
  }
}

// For a sandbox whose browser folder has no annotations yet. A failed read
// opens the browser without them rather than not at all.
export async function storedAnnotations(
  sessionId: string
): Promise<BrowserAnnotation[]> {
  const rows = await db
    .select()
    .from(schema.sessionBrowserAnnotation)
    .where(eq(schema.sessionBrowserAnnotation.sessionId, sessionId))
    .orderBy(schema.sessionBrowserAnnotation.number)
    .catch((err: unknown) => {
      logger.warn({ err, sessionId }, "Couldn't read the stored annotations")
      return []
    })
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    color: row.color,
    by: { userId: row.authorId ?? "former-member", name: row.authorName },
    note: row.note,
    element: row.element,
  }))
}

// Copies the gateway's annotations into the database: its list is the truth
// while the sandbox lives, so rows it no longer has (sent to Lor, removed)
// go. Nothing changes while the sandbox has no list at all.
export async function syncAnnotations(sessionId: string): Promise<void> {
  const items = await readBrowserAnnotations(sessionId)
  if (!items) return
  const clean = items.map(cleanBrowserAnnotation)
  const authorIds = [
    ...new Set(
      clean.map((item) => item.by.userId).filter((id) => UUID.test(id))
    ),
  ]
  const known = new Set(
    authorIds.length > 0
      ? (
          await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(inArray(schema.user.id, authorIds))
        ).map((row) => row.id)
      : []
  )
  await db.transaction(async (tx) => {
    const table = schema.sessionBrowserAnnotation
    await tx.delete(table).where(
      clean.length > 0
        ? and(
            eq(table.sessionId, sessionId),
            notInArray(
              table.id,
              clean.map((item) => item.id)
            )
          )
        : eq(table.sessionId, sessionId)
    )
    for (const item of clean) {
      const values = {
        number: item.number,
        authorId: known.has(item.by.userId) ? item.by.userId : null,
        authorName: item.by.name,
        color: item.color,
        note: item.note,
        element: item.element,
      }
      await tx
        .insert(table)
        .values({ id: item.id, sessionId, ...values })
        .onConflictDoUpdate({
          target: table.id,
          set: values,
          // An id from another session's sandbox never overwrites this row.
          setWhere: eq(table.sessionId, sessionId),
        })
    }
  })
}

// A link turned off or made private stops working for people already on it.
export const endPreviewViewsSoon = (sessionId: string) =>
  void endPreviewViews(sessionId).catch((err: unknown) =>
    logger.warn({ err, sessionId }, "Couldn't end the preview link's views")
  )

// One copy at a time per session (in this API process): each reads the
// sandbox after the one before it wrote, so an older read never lands last.
const storing = new Map<string, Promise<void>>()

export function storeAnnotations(sessionId: string): Promise<void> {
  const run = (storing.get(sessionId) ?? Promise.resolve())
    .catch(() => {})
    .then(() => syncAnnotations(sessionId))
  storing.set(sessionId, run)
  run
    .finally(() => {
      if (storing.get(sessionId) === run) storing.delete(sessionId)
    })
    .catch(() => {})
  return run
}
