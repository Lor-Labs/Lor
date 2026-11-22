import { eq, sql } from "drizzle-orm"
import { db, schema } from "../index"

// Creatures that were replaced (reference/always-on-agents.md, decision
// 39): moves channels that picked the old one to the new id. A channel that
// never picked a creature needs nothing, its creature is derived. Without
// this a picked old creature is an unknown id and falls back to the derived
// one. Idempotent. Independent of db:push: run order does not matter.
//
//   pnpm --filter @repo/db exec tsx src/scripts/rename-creatures.ts \
//     [--dry-run]

const RENAMES = [
  { from: "golem", to: "skeleton" },
  { from: "griffin", to: "alien" },
] as const

const dryRun = process.argv.includes("--dry-run")

for (const { from, to } of RENAMES) {
  const [found] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.channel)
    .where(eq(schema.channel.agentCreature, from))
  const count = found?.count ?? 0
  if (dryRun) {
    console.log(`${count} channel(s) have the ${from}. Dry run: no change.`)
    continue
  }
  await db
    .update(schema.channel)
    .set({ agentCreature: to })
    .where(eq(schema.channel.agentCreature, from))
  console.log(`${count} channel(s) moved from the ${from} to the ${to}.`)
}

process.exit(0)
