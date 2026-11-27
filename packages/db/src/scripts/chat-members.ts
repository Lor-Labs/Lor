// Chats are open and hidden (reference/agents-and-chats.md, decisions 35 and
// 36): a chat is in the list of the people in it, its own `channel_member`
// rows. Channels from before that had no such rows and were in everyone's
// sidebar, so a text channel nobody is in gets everyone who can see it.
//
// scripts/push.mjs runs this after the one `pnpm db:push` that adds
// `channel_member.hidden_at` (it asks first with `--needed`: exit 0 when the
// column is missing, 10 when not). After that a chat nobody is in is one
// everyone left, so it is not filled again. Run by hand, it fills every chat
// with no people. Take it out of push.mjs once every environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/chat-members.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"
import { joinEmptyChats } from "../queries/chat-members"

if (process.argv.includes("--needed")) {
  const [row] = await db.execute<{ found: number }>(sql`
    select count(*)::int as found from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'channel_member' and column_name = 'hidden_at'`)
  await closeDb()
  process.exit(row?.found ? 10 : 0)
}

const count = async () => {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from channel_member`
  )
  return row?.count ?? 0
}
const before = await count()
await joinEmptyChats()
console.log(
  `Chat members: ${(await count()) - before} added to chats nobody was in.`
)
await closeDb()
