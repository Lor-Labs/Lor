// An agent's facts lost their scope (reference/agents-and-chats.md,
// decision 22): what an agent knows is shared with the workspace.
//
// scripts/push.mjs runs this before every `pnpm db:push`. It drops
// `agent_fact.scope_channel_id` itself because the same push adds
// `agent_fact.archived_at`: with a column gone and a column new in one
// table, drizzle-kit asks whether one was renamed into the other, and
// answering yes would turn a scope into an archive date. A no-op once the
// column is gone, and on a new database. Take it out of push.mjs once every
// environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/agent-facts-unscoped.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

const [scoped] = await db.execute<{ facts: number }>(sql`
  select count(*)::int as facts
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'agent_fact' and column_name = 'scope_channel_id'`)

if (scoped?.facts) {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from agent_fact where scope_channel_id is not null`
  )
  await db.execute(sql`alter table agent_fact drop column scope_channel_id`)
  console.log(
    `Agent facts unscoped: ${row?.count ?? 0} fact(s) that were kept to a private channel are now their agent's like the rest.`
  )
} else {
  console.log("Agent facts unscoped: nothing to do.")
}
await closeDb()
