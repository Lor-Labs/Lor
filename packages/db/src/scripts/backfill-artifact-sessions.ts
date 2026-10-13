// One-off for reference/session-files-runbook.md Step 4a: gives existing
// artifacts the session (thread) that owns them, so rewriting a filename
// versions it and Lor's sandbox is reseeded with it. Plan artifacts take the
// plan's thread, the rest the thread of the run that made them. When a
// session already has that path, the older duplicate stays unscoped. Safe to
// rerun. Run after db:push, once per environment:
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-artifact-sessions.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-artifact-sessions.ts
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")
const { agentRun, artifact, plan } = schema

const candidates = await db
  .select({
    id: artifact.id,
    path: artifact.path,
    threadRootId: sql<
      string | null
    >`coalesce(${plan.threadRootId}, ${agentRun.threadRootId})`,
  })
  .from(artifact)
  .leftJoin(plan, eq(plan.id, artifact.planId))
  .leftJoin(agentRun, eq(agentRun.id, artifact.originRunId))
  .where(isNull(artifact.threadRootId))
  .orderBy(desc(artifact.updatedAt), desc(artifact.id))

const sessionPath = (threadRootId: string, path: string) =>
  `${threadRootId}\u0000${path}`
const taken = new Set(
  (
    await db
      .select({ threadRootId: artifact.threadRootId, path: artifact.path })
      .from(artifact)
      .where(isNotNull(artifact.threadRootId))
  ).flatMap((row) =>
    row.threadRootId ? [sessionPath(row.threadRootId, row.path)] : []
  )
)

let scoped = 0
let duplicates = 0
let orphans = 0
for (const row of candidates) {
  if (!row.threadRootId) {
    orphans += 1
    continue
  }
  const key = sessionPath(row.threadRootId, row.path)
  if (taken.has(key)) {
    duplicates += 1
    continue
  }
  taken.add(key)
  scoped += 1
  console.log(`${row.id}  ${row.threadRootId}  ${row.path}`)
  if (dryRun) continue
  await db
    .update(artifact)
    // Keeps updatedAt: the Files list sorts by it.
    .set({ threadRootId: row.threadRootId, updatedAt: artifact.updatedAt })
    .where(and(eq(artifact.id, row.id), isNull(artifact.threadRootId)))
}

console.log(
  `${dryRun ? "Would scope" : "Scoped"} ${scoped} artifacts; ${duplicates} older duplicates and ${orphans} with no plan or run stay unscoped.`
)
process.exit(0)
