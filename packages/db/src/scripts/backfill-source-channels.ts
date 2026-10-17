// One-off for reference/planned/session-memory.md Step 1: gives remembered
// sources the channel of the trigger that stored them, so readers apply that
// channel's audience. Rows don't record their trigger, so a row gets a channel
// only when all of its connection's Remember triggers sit in one channel.
// Ambiguous rows are archived (fail closed); a later Remember revives them.
// Safe to rerun. Run after db:push, once per environment:
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-source-channels.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/backfill-source-channels.ts
import { and, count, eq, inArray, isNull } from "drizzle-orm"
import { db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")
const { connectorTrigger, source } = schema

const unscoped = and(isNull(source.channelId), eq(source.status, "active"))

const pending = await db
  .select({ connectionId: source.connectionId, rows: count() })
  .from(source)
  .where(unscoped)
  .groupBy(source.connectionId)

const triggers =
  pending.length === 0
    ? []
    : await db
        .selectDistinct({
          connectionId: connectorTrigger.connectionId,
          channelId: connectorTrigger.channelId,
        })
        .from(connectorTrigger)
        .where(
          and(
            inArray(
              connectorTrigger.connectionId,
              pending.map((p) => p.connectionId)
            ),
            eq(connectorTrigger.remember, true)
          )
        )

const channelsByConnection = new Map<string, string[]>()
for (const t of triggers) {
  const channels = channelsByConnection.get(t.connectionId) ?? []
  channels.push(t.channelId)
  channelsByConnection.set(t.connectionId, channels)
}

let scoped = 0
let archived = 0
for (const { connectionId, rows } of pending) {
  const channels = channelsByConnection.get(connectionId) ?? []
  const channelId = channels.length === 1 ? channels[0] : undefined
  const where = and(eq(source.connectionId, connectionId), unscoped)
  if (channelId) {
    scoped += rows
    console.log(`${connectionId}: ${rows} rows -> channel ${channelId}`)
    if (!dryRun) await db.update(source).set({ channelId }).where(where)
  } else {
    archived += rows
    console.log(
      `${connectionId}: ${rows} rows archived (${channels.length} Remember channels)`
    )
    if (!dryRun)
      await db.update(source).set({ status: "archived" }).where(where)
  }
}

console.log(
  dryRun
    ? `\nDry run: ${scoped} rows would get a channel, ${archived} would be archived.`
    : `\nScoped ${scoped} rows, archived ${archived}.`
)
process.exit(0)
