// Each agent posts as a bot user of its own (reference/agents-and-chats.md,
// decision 37): the user has the agent's id, so a message's author says
// which agent wrote it and a mention of the agent is a mention of a user.
//
// scripts/push.mjs runs this before every `pnpm db:push`, because the push
// adds the foreign key from `agent.id` to `user.id`:
// - every agent with no user gets one;
// - where `message.agent_id` was pushed (agents sharing a chat while they
//   all posted as Lor), those messages get their agent as author and the
//   column is dropped here, so the push asks nothing about it;
// - what an agent said in a chat before that (`agent_post` by Lor) becomes
//   the chat's first agent's, as the app has shown it all along. A chat
//   with no agent left keeps them as Lor's.
// A no-op once done, and on a new database. Take it out of push.mjs once
// every environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/agent-bot-users.ts
import { sql } from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { closeDb, db } from "../index"

async function exists(table: string, column?: string) {
  const [row] = await db.execute<{ found: number }>(
    column
      ? sql`select count(*)::int as found from information_schema.columns
            where table_schema = current_schema()
              and table_name = ${table} and column_name = ${column}`
      : sql`select count(*)::int as found from information_schema.tables
            where table_schema = current_schema() and table_name = ${table}`
  )
  return Boolean(row?.found)
}

if (await exists("agent")) {
  const made = await db.execute<{ id: string }>(sql`
    insert into "user" (id, name, email, email_verified, onboarding_completed, is_bot)
    select a.id, a.name, a.id || '@agent.lor.invalid', true, true, true
    from agent a
    where not exists (select 1 from "user" u where u.id = a.id)
    returning id`)
  let moved = 0
  if (await exists("message", "agent_id")) {
    const rows = await db.execute<{ id: string }>(sql`
      update message set author_id = agent_id
      where agent_id is not null and author_id = ${LOR_USER_ID}::uuid
      returning id`)
    moved = rows.length
    await db.execute(sql`alter table message drop column agent_id`)
  }
  const earlier = await db.execute<{ id: string }>(sql`
    update message m set author_id = f.agent_id
    from (
      select distinct on (channel_id) channel_id, agent_id
      from channel_agent
      order by channel_id, created_at, agent_id
    ) f
    where m.channel_id = f.channel_id
      and m.type = 'agent_post' and m.author_id = ${LOR_USER_ID}::uuid
    returning m.id`)
  console.log(
    `Agent bot users: ${made.length} made, ${moved + earlier.length} message(s) given their agent as author.`
  )
} else {
  console.log("Agent bot users: nothing to do.")
}
await closeDb()
