// One-off for reference/planned/context-engine-phase-2.md Step 2: deletes the
// `source` rows written by Remember (summaries, your own webhook deliveries,
// releases, list entries). Every ingested row, tombstones included, has a
// fetchedAt. No refetch: ingestion has no backfill, so items return as they
// change.
// Run after db:push, once per environment:
//   pnpm --filter @repo/db exec tsx src/scripts/delete-summary-sources.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/delete-summary-sources.ts
import { count, isNull } from "drizzle-orm"
import { closeDb, db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")
const old = isNull(schema.source.fetchedAt)

const [row] = await db.select({ rows: count() }).from(schema.source).where(old)
if (dryRun) {
  console.log(`${row?.rows ?? 0} summary sources would be deleted.`)
} else {
  const deleted = await db
    .delete(schema.source)
    .where(old)
    .returning({ id: schema.source.id })
  console.log(`Deleted ${deleted.length} summary sources.`)
}
await closeDb()
