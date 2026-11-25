// Chats are open and hidden (reference/agents-and-chats.md, decisions 35 and
// 36): a chat is in the list of the people in it, its own `channel_member`
// rows. Channels from before that had no such rows and were in everyone's
// sidebar, so a text channel nobody is in gets everyone who can see it.
//
// scripts/push.mjs runs this after every `pnpm db:push`. Only chats with no
// people are filled, so it never puts someone back in a chat they left, and
// a second run changes nothing. Take it out of push.mjs once every
// environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/chat-members.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"
import { joinEmptyChats } from "../queries/chat-members"

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
