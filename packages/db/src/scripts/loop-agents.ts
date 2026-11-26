// A Loop belongs to an agent (reference/agents-and-chats.md, decisions 15,
// 23 and 27): `loop.agent_id` is the agent that runs it, and its channel is
// where it reports. Loops from before were run by their channel's agent, so
// each goes to the first agent of its chat, which is the one that ran it.
//
// scripts/push.mjs runs this before every `pnpm db:push`. It adds the column
// itself and fills it in the same run, so it happens once per database: a
// Loop left with no agent later (made in a chat that had none) is never
// handed to one by a push. The push then adds the foreign key and the index.
// A no-op once the column is there, and on a new database. Take it out of
// push.mjs once every environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/loop-agents.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

const exists = async (table: string, column?: string) => {
  const rows = column
    ? await db.execute(
        sql`select 1 from information_schema.columns where table_schema = current_schema() and table_name = ${table} and column_name = ${column}`
      )
    : await db.execute(
        sql`select 1 from information_schema.tables where table_schema = current_schema() and table_name = ${table}`
      )
  return rows.length > 0
}

if (
  (await exists("loop")) &&
  (await exists("channel_agent")) &&
  !(await exists("loop", "agent_id"))
) {
  const moved = await db.transaction(async (tx) => {
    await tx.execute(sql`alter table loop add column agent_id uuid`)
    return tx.execute(sql`
      update loop l
      set agent_id = (
        select ca.agent_id
        from channel_agent ca
        where ca.channel_id = l.channel_id
        order by ca.created_at, ca.agent_id
        limit 1
      )
      where exists (
        select 1 from channel_agent ca where ca.channel_id = l.channel_id
      )
      returning l.id`)
  })
  console.log(
    `Loop agents: ${moved.length} Loop(s) now belong to the first agent of their chat.`
  )
} else {
  console.log("Loop agents: nothing to do.")
}
await closeDb()
