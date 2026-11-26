// A Discord channel an agent is in is a place, not a Lor chat
// (reference/agents-and-chats.md, decision 51). Chats linked to Discord from
// before become places: the row keeps its messages, Loops and sessions and
// leaves every list in Lor, its server is connected to the workspace, and
// its first agent (the only one that posted there) gets the link's webhook
// and @mention role as its own.
//
// scripts/push.mjs runs this after every `pnpm db:push`, which makes the
// tables and the `place` kind. A second run changes nothing. Take it out of
// push.mjs once every environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/discord-places.ts
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

const firstAgent = sql`
  join lateral (
    select ca.agent_id from channel_agent ca
    where ca.channel_id = l.channel_id
    order by ca.created_at, ca.agent_id
    limit 1
  ) fa on true`

await db.execute(sql`
  insert into discord_guild (guild_id, workspace_id, name, connected_by_id)
  select distinct on (l.guild_id)
    l.guild_id, l.workspace_id, l.guild_name, l.linked_by_id
  from channel_discord_link l
  order by l.guild_id, l.created_at
  on conflict do nothing`)
await db.execute(sql`
  insert into discord_agent_webhook
    (channel_id, agent_id, webhook_id, webhook_token, webhook_creature)
  select l.channel_id, fa.agent_id, l.webhook_id, l.webhook_token,
    l.webhook_creature
  from channel_discord_link l ${firstAgent}
  where not exists (
    select 1 from discord_agent_webhook w where w.channel_id = l.channel_id
  )
  on conflict do nothing`)
await db.execute(sql`
  insert into discord_agent_role (guild_id, agent_id, role_id, role_name)
  select distinct on (l.guild_id, fa.agent_id)
    l.guild_id, fa.agent_id, l.agent_role_id,
    coalesce(l.agent_role_name, 'Lor')
  from channel_discord_link l ${firstAgent}
  where l.agent_role_id is not null
  order by l.guild_id, fa.agent_id, l.created_at
  on conflict do nothing`)
// A private chat's own people were also who could see it; a place is
// managed by whoever manages the workspace's agents.
const places = await db.execute<{ id: string }>(sql`
  update channel c set kind = 'place',
    audience = case when c.parent_id is null then 'workspace' else c.audience end
  from channel_discord_link l
  where l.channel_id = c.id and c.kind <> 'place'
  returning c.id`)
// A place has agents, not people: it leaves the lists of whoever was in the
// chat it was.
await db.execute(sql`
  delete from channel_member m
  using channel c
  where c.id = m.channel_id and c.kind = 'place'`)
console.log(`Discord places: ${places.length} linked chat(s) became places.`)
await closeDb()
