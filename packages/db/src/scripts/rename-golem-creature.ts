import { eq, sql } from "drizzle-orm"
import { db, schema } from "../index"

// The golem became the skeleton (reference/always-on-agents.md, decision
// 39): moves channels that picked the golem to the new id. A channel that
// never picked a creature needs nothing, its creature is derived. Without
// this a picked golem is an unknown id and falls back to the derived one.
// Idempotent. Independent of db:push: run order does not matter.
//
//   pnpm --filter @repo/db exec tsx src/scripts/rename-golem-creature.ts \
//     [--dry-run]

const dryRun = process.argv.includes("--dry-run")

const [found] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(schema.channel)
  .where(eq(schema.channel.agentCreature, "golem"))
const count = found?.count ?? 0

if (dryRun) {
  console.log(`${count} channel(s) have the golem. Dry run: nothing changed.`)
} else {
  await db
    .update(schema.channel)
    .set({ agentCreature: "skeleton" })
    .where(eq(schema.channel.agentCreature, "golem"))
  console.log(`${count} channel(s) moved from the golem to the skeleton.`)
}

process.exit(0)
