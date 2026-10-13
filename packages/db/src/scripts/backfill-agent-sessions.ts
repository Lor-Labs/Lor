// One-off for the workspace model (reference/workspace-model-runbook.md,
// Step 3): turns every pre-redesign Lor thread into a session, so old Lor work
// shows up in session lists. The old root stays a visible chat message, and
// everyone who wrote in the thread is subscribed. Safe to rerun. Run after
// db:push, once per environment:
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-agent-sessions.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-agent-sessions.ts
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  notInArray,
  or,
} from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")
const { agentRun, agentSession, channel, message, plan, threadSubscription } =
  schema

const runRoots = await db
  .selectDistinct({ id: agentRun.threadRootId })
  .from(agentRun)
  .where(isNotNull(agentRun.threadRootId))
const planRoots = await db.selectDistinct({ id: plan.threadRootId }).from(plan)
const rootIds = [
  ...new Set(
    [...runRoots, ...planRoots]
      .map((row) => row.id)
      .filter((id): id is string => id !== null)
  ),
]

// Workspace text channels only: DMs never have Lor, and call chats stay calls.
const roots =
  rootIds.length === 0
    ? []
    : await db
        .select({
          id: message.id,
          channelId: message.channelId,
          workspaceId: channel.workspaceId,
          authorId: message.authorId,
          content: message.content,
          createdAt: message.createdAt,
        })
        .from(message)
        .innerJoin(channel, eq(message.channelId, channel.id))
        .where(
          and(
            inArray(message.id, rootIds),
            isNull(message.threadRootId),
            notInArray(message.type, ["voice_session", "agent_session"]),
            eq(channel.type, "text")
          )
        )

const planTitles = new Map(
  (rootIds.length === 0
    ? []
    : await db
        .select({ threadRootId: plan.threadRootId, title: plan.title })
        .from(plan)
        .where(inArray(plan.threadRootId, rootIds))
  ).map((row) => [row.threadRootId, row.title])
)

function titleFrom(content: string | null) {
  const words = (content ?? "")
    .replace(/<@[0-9a-f-]+>/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return "Lor thread"
  const title = words.slice(0, 8).join(" ")
  return words.length > 8 ? `${title}…` : title
}

let created = 0
for (const root of roots) {
  const { workspaceId } = root
  if (!workspaceId) continue
  const title = planTitles.get(root.id) ?? titleFrom(root.content)

  const [latest] = await db
    .select({ at: max(message.createdAt) })
    .from(message)
    .where(eq(message.threadRootId, root.id))
  const writers = await db
    .selectDistinct({ userId: message.authorId })
    .from(message)
    .where(
      and(
        or(eq(message.id, root.id), eq(message.threadRootId, root.id)),
        ne(message.authorId, LOR_USER_ID)
      )
    )

  console.log(
    `${root.id}  "${title}"  (${writers.length} subscriber${writers.length === 1 ? "" : "s"})`
  )
  if (dryRun) continue

  await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(agentSession)
      .values({
        workspaceId,
        channelId: root.channelId,
        threadRootId: root.id,
        creatorId: root.authorId === LOR_USER_ID ? null : root.authorId,
        origin: "chat",
        title,
        lastActivityAt: latest?.at ?? root.createdAt,
        createdAt: root.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: agentSession.id })
    if (!session) return
    created += 1
    if (writers.length > 0) {
      await tx
        .insert(threadSubscription)
        .values(
          writers.map((writer) => ({
            threadRootId: root.id,
            userId: writer.userId,
          }))
        )
        .onConflictDoNothing()
    }
  })
}

console.log(
  dryRun
    ? `\nDry run: ${roots.length} Lor threads would become sessions.`
    : `\nCreated ${created} sessions (${roots.length - created} already existed).`
)
process.exit(0)
