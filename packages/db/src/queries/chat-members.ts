import { type SQL, sql } from "drizzle-orm"
import { db } from "../index"

// Who is in a chat: `channel_member` rows on the chat itself
// (reference/agents-and-chats.md, decisions 35 and 36). Until New chat picks
// its people, a chat starts with everyone who can see it, and a person who
// gains sight of chats is put in them, so nobody's list is empty.

type Executor = Pick<typeof db, "execute">

// Puts people in the text chats they can see, where `scope` narrows which
// chats (`c`) and which workspace members (`wm`). Bots are never members.
// An existing row is kept, with its pin and hide.
async function joinVisible(scope: SQL, executor: Executor) {
  await executor.execute(sql`
    insert into channel_member (channel_id, user_id)
    select c.id, wm.user_id
    from channel c
    join workspace_member wm on wm.workspace_id = c.workspace_id
    join "user" u on u.id = wm.user_id and not u.is_bot
    left join channel p on p.id = c.parent_id
    where c.type = 'text' and c.archived_at is null
      -- A place (a Slack or Discord channel) has agents, not people.
      and c.kind::text <> 'place'
      and (
        coalesce(p.audience, c.audience) = 'workspace'
        or exists (
          select 1 from channel_member m
          where m.channel_id = coalesce(p.id, c.id) and m.user_id = wm.user_id
        )
      )
      and ${scope}
    on conflict do nothing`)
}

// New chats start with everyone who can see them.
export async function joinChatAudience(
  channelIds: string[],
  executor: Executor = db
) {
  if (channelIds.length === 0) return
  await joinVisible(
    sql`c.id in (${sql.join(
      channelIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )})`,
    executor
  )
}

// People who just gained sight of chats (a new workspace member, or someone
// added to a private project) are put in them. `containerId` keeps it to
// one project's chats; without it, every chat in the workspace they can see.
export async function joinVisibleChats(
  input: { workspaceId: string; userIds: string[]; containerId?: string },
  executor: Executor = db
) {
  if (input.userIds.length === 0) return
  const people = sql`wm.user_id in (${sql.join(
    input.userIds.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`
  await joinVisible(
    input.containerId
      ? sql`c.workspace_id = ${input.workspaceId}::uuid and ${people} and coalesce(p.id, c.id) = ${input.containerId}::uuid`
      : sql`c.workspace_id = ${input.workspaceId}::uuid and ${people}`,
    executor
  )
}

// A chat nobody is in gets everyone who can see it: channels from before
// chats had a list of their people (scripts/chat-members.ts).
export async function joinEmptyChats(executor: Executor = db) {
  await joinVisible(
    sql`not exists (select 1 from channel_member m where m.channel_id = c.id)`,
    executor
  )
}
