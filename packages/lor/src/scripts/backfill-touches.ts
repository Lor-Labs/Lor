// One-off for reference/planned/session-memory.md Step 5: records touches for
// past Lor sessions from their stored runs, replies and prompts, the same way
// the worker does after each new run. Safe to rerun (duplicates are ignored).
// Run after db:push, once per environment:
//   pnpm --filter @repo/lor exec tsx src/scripts/backfill-touches.ts --dry-run
//   pnpm --filter @repo/lor exec tsx src/scripts/backfill-touches.ts
import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNotNull,
  LOR_USER_ID,
  ne,
  schema,
} from "@repo/db"
import { recordRunTouches } from "../touches"

const dryRun = process.argv.includes("--dry-run")
const { agentRun, agentSession, message } = schema

async function main() {
  const sessions = await db
    .select({
      workspaceId: agentSession.workspaceId,
      channelId: agentSession.channelId,
      threadRootId: agentSession.threadRootId,
    })
    .from(agentSession)

  let runCount = 0
  for (const session of sessions) {
    const runs = await db
      .select({ id: agentRun.id, reply: message.content })
      .from(agentRun)
      .leftJoin(message, eq(message.id, agentRun.messageId))
      .where(
        and(
          eq(agentRun.threadRootId, session.threadRootId),
          inArray(agentRun.state, ["complete", "stopped"])
        )
      )
      .orderBy(asc(agentRun.createdAt))
    runCount += runs.length
    if (dryRun) continue

    for (const run of runs) {
      await recordRunTouches({
        ...session,
        runId: run.id,
        replyText: run.reply ?? "",
        promptTexts: [],
      })
    }
    // Pasted links and the starting context, once per session.
    const prompts = await db
      .select({ content: message.content })
      .from(message)
      .where(
        and(
          eq(message.threadRootId, session.threadRootId),
          ne(message.authorId, LOR_USER_ID),
          isNotNull(message.content)
        )
      )
    await recordRunTouches({
      ...session,
      runId: null,
      replyText: "",
      promptTexts: prompts.map((p) => p.content ?? ""),
    })
  }

  console.log(
    dryRun
      ? `Dry run: ${sessions.length} sessions, ${runCount} runs would be read.`
      : `Recorded touches for ${sessions.length} sessions (${runCount} runs).`
  )
  process.exit(0)
}

main().catch((error) => {
  console.error("Touch backfill failed:", error)
  process.exit(1)
})
