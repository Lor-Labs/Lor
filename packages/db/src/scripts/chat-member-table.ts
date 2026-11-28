// Who is in a chat moved from its own table (`chat_member`, pushed for a
// day) onto `channel_member`, which already lists the people of DMs and
// private channels (reference/agents-and-chats.md, decisions 35 and 36).
//
// scripts/push.mjs runs this before every `pnpm db:push`: a database that
// has `chat_member` keeps its rows, with their pins and hides, and the
// table is dropped here so the push asks nothing about it. A no-op on a
// database that never had it. Take it out of push.mjs once every
// environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/chat-member-table.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

const [found] = await db.execute<{ found: number }>(sql`
  select count(*)::int as found from information_schema.tables
  where table_schema = current_schema() and table_name = 'chat_member'`)

if (found?.found) {
  const moved = await db.transaction(async (tx) => {
    // The push adds these too; here first, so the rows can carry them.
    await tx.execute(sql`
      alter table channel_member
        add column if not exists pinned_at timestamp,
        add column if not exists hidden_at timestamp`)
    const rows = await tx.execute<{ id: string }>(sql`
      insert into channel_member (channel_id, user_id, created_at, pinned_at, hidden_at)
      select channel_id, user_id, created_at, pinned_at, hidden_at from chat_member
      on conflict (channel_id, user_id) do update
        set pinned_at = excluded.pinned_at, hidden_at = excluded.hidden_at
      returning id`)
    await tx.execute(sql`drop table chat_member`)
    return rows.length
  })
  console.log(`Chat members: ${moved} moved onto channel_member.`)
} else {
  console.log("Chat members table: nothing to move.")
}
await closeDb()
