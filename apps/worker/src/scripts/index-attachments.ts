// Backfill the attachment index (reference/attachment-search.md, Step 2):
// indexes attachments posted before indexing existed, then embeds any chunk
// saved without a vector. Idempotent — already-indexed attachments are skipped.
// --reindex-documents first deletes the rows of every non-image attachment so
// documents are rebuilt with the current extraction; image rows (costly
// transcriptions) are kept.
//
//   pnpm --filter @repo/worker exec tsx src/scripts/index-attachments.ts [--workspace <id>] [--reindex-documents]
//
// ATTACHMENT_INDEX_CONCURRENCY (default 4, max 16) bounds parallel messages.
import { recordUsage } from "@repo/billing"
import {
  and,
  db,
  desc,
  eq,
  isNotNull,
  lt,
  notLike,
  or,
  schema,
  sql,
} from "@repo/db"
import {
  embedPendingChunks,
  indexMessageAttachments,
} from "@repo/lor/attachments"

type OnUsage = NonNullable<Parameters<typeof indexMessageAttachments>[1]>

const PAGE_SIZE = 500
const concurrency = Number.parseInt(
  process.env.ATTACHMENT_INDEX_CONCURRENCY ?? "4",
  10
)
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error(
    "ATTACHMENT_INDEX_CONCURRENCY must be an integer from 1 to 16"
  )
}
const workspaceFlag = process.argv.indexOf("--workspace")
const workspaceId =
  workspaceFlag >= 0 ? (process.argv[workspaceFlag + 1] ?? null) : null

if (process.argv.includes("--reindex-documents")) {
  const deleted = await db
    .delete(schema.attachmentChunk)
    .where(
      and(
        notLike(schema.attachmentChunk.contentType, "image/%"),
        workspaceId
          ? eq(schema.attachmentChunk.workspaceId, workspaceId)
          : undefined
      )
    )
    .returning({ id: schema.attachmentChunk.id })
  console.log(`deleted ${deleted.length} document rows for reindexing`)
}

const totals = { inputTokens: 0, outputTokens: 0, costEvents: 0 }
// Drained after each page and before exit, so usage rows are not lost and
// settled promises are not kept for the whole scan.
const recorded: Promise<void>[] = []
const drainUsage = () => Promise.allSettled(recorded.splice(0))
const usageFor =
  (messageId: string | null, channelId: string | null): OnUsage =>
  (u) => {
    totals.inputTokens += u.inputTokens ?? 0
    totals.outputTokens += u.outputTokens ?? 0
    totals.costEvents++
    recorded.push(recordUsage(u, { messageId, channelId }))
  }

type Candidate = { id: string; channelId: string; createdAt: Date }

// DMs have no workspace and are never indexed.
async function page(cursor: Candidate | null): Promise<Candidate[]> {
  return db
    .select({
      id: schema.message.id,
      channelId: schema.message.channelId,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .where(
      and(
        isNotNull(schema.channel.workspaceId),
        workspaceId ? eq(schema.channel.workspaceId, workspaceId) : undefined,
        eq(schema.message.excludedFromMemory, false),
        sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`,
        cursor
          ? or(
              lt(schema.message.createdAt, cursor.createdAt),
              and(
                eq(schema.message.createdAt, cursor.createdAt),
                lt(schema.message.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(PAGE_SIZE)
}

let processed = 0
let failed = 0
let cursor: Candidate | null = null
for (;;) {
  const batch = await page(cursor)
  if (batch.length === 0) break
  for (let i = 0; i < batch.length; i += concurrency) {
    await Promise.all(
      batch.slice(i, i + concurrency).map(async (m) => {
        try {
          await indexMessageAttachments(m.id, usageFor(m.id, m.channelId))
        } catch (err) {
          failed++
          console.error(`message ${m.id}: ${(err as Error).message}`)
        }
        processed++
      })
    )
  }
  await drainUsage()
  console.log(`messages checked: ${processed} (failed: ${failed})`)
  cursor = batch[batch.length - 1] ?? null
}

const pending = await embedPendingChunks(workspaceId, usageFor(null, null))
await drainUsage()
console.log(
  `done: ${processed} messages checked, ${failed} failed; ${pending.embedded} pending chunks embedded, ${pending.failed} failed; ${totals.costEvents} model calls, ${totals.inputTokens} input / ${totals.outputTokens} output tokens`
)
process.exit(failed > 0 || pending.failed > 0 ? 1 : 0)
