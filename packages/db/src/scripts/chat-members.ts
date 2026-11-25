// Chats are open and hidden (reference/agents-and-chats.md, decisions 35 and
// 36): a chat is in the list of the people in it (`chat_member`). Channels
// from before that had no such list and were in everyone's sidebar, so each
// existing text channel starts with everyone who can see it.
//
// scripts/push.mjs runs this after every `pnpm db:push`, since the push
// creates the table. It fills the table once, while it is empty, and is a
// no-op after: running it again would put people back in chats they left.
// Take it out of push.mjs once every environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/chat-members.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"
import { joinAllChats } from "../queries/chat-members"

const [filled] = await db.execute<{ found: number }>(
  sql`select count(*)::int as found from (select 1 from chat_member limit 1) rows`
)
if (filled?.found) {
  console.log("Chat members: already filled.")
} else {
  await joinAllChats()
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from chat_member`
  )
  console.log(
    `Chat members: ${row?.count ?? 0} added, everyone who can see each chat.`
  )
}
await closeDb()
