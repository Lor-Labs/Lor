// Agents come off channels (reference/agents-and-chats.md, step 1): every
// text channel's agent settings become an `agent` row that the channel points
// at, and the channel's facts move to that agent.
//
// scripts/push.mjs runs this before every `pnpm db:push`, because that push
// drops the channel's old agent_* columns: this copies them first. It runs
// once per database (the marker is `channel.agent_id` existing), in one
// transaction, and is a no-op after. Take it out of push.mjs once every
// environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/agents-from-channels.ts \
//     [--dry-run]
import { agentIdentityFor } from "@repo/utils/bestiary"
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

const dryRun = process.argv.includes("--dry-run")

type Executor = Pick<typeof db, "execute">

async function tableExists(tx: Executor, table: string) {
  const rows = await tx.execute(
    sql`select 1 from information_schema.tables where table_schema = current_schema() and table_name = ${table}`
  )
  return rows.length > 0
}

async function columnExists(tx: Executor, table: string, column: string) {
  const rows = await tx.execute(
    sql`select 1 from information_schema.columns where table_schema = current_schema() and table_name = ${table} and column_name = ${column}`
  )
  return rows.length > 0
}

type ChannelRow = Record<string, unknown> & {
  id: string
  workspace_id: string
  name: string | null
  creator_id: string | null
  container_id: string
  container_audience: "workspace" | "members"
  agent_name: string | null
  agent_creature: string | null
  agent_identity_updated_at: Date | null
  agent_brief: string | null
  agent_brief_updated_at: Date | null
  agent_model: string | null
}

class DryRun extends Error {}

async function run() {
  if (!(await tableExists(db, "channel"))) {
    console.log("Agents from channels: a new database, nothing to move.")
    return
  }
  if (await columnExists(db, "channel", "agent_id")) {
    console.log("Agents from channels: already done.")
    return
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      create table if not exists agent (
        id uuid primary key default gen_random_uuid(),
        created_at timestamp not null default now(),
        updated_at timestamp not null default now(),
        workspace_id uuid not null references workspace(id) on delete cascade,
        name text not null,
        creature text not null,
        identity_updated_at timestamp,
        role text,
        brief text,
        brief_updated_at timestamp,
        model text,
        access_container_id uuid references channel(id) on delete cascade,
        created_by_id uuid references "user"(id) on delete set null
      )`)
    await tx.execute(
      sql`alter table channel add column agent_id uuid references agent(id) on delete set null`
    )

    // A database that never had the per-channel agent columns (the always-on
    // batch was not pushed there) still gets an agent per text channel.
    const legacy = await columnExists(tx, "channel", "agent_name")
    const hadFacts = await tableExists(tx, "channel_agent_fact")
    const old = (column: string, type: string) =>
      legacy ? sql.raw(`c.${column}`) : sql.raw(`null::${type}`)
    // Text channels, and any channel that somehow holds facts.
    const withFacts = hadFacts
      ? sql`or c.id in (select channel_id from channel_agent_fact)`
      : sql``
    const channels = await tx.execute<ChannelRow>(sql`
      select c.id, c.workspace_id, c.name, c.creator_id,
        coalesce(p.id, c.id) as container_id,
        coalesce(p.audience, c.audience) as container_audience,
        ${old("agent_name", "text")} as agent_name,
        ${old("agent_creature", "text")} as agent_creature,
        ${old("agent_identity_updated_at", "timestamp")} as agent_identity_updated_at,
        ${old("agent_brief", "text")} as agent_brief,
        ${old("agent_brief_updated_at", "timestamp")} as agent_brief_updated_at,
        ${old("agent_model", "text")} as agent_model
      from channel c
      left join channel p on p.id = c.parent_id
      where c.workspace_id is not null and (c.type = 'text' ${withFacts})
      order by c.created_at`)

    for (const channel of channels) {
      // Seeded on the channel id: the name and face the team already sees.
      const identity = agentIdentityFor(channel.id, {
        name: channel.agent_name,
        creature: channel.agent_creature,
      })
      const [made] = await tx.execute<{ id: string }>(sql`
        insert into agent (workspace_id, name, creature, identity_updated_at,
          role, brief, brief_updated_at, model, access_container_id,
          created_by_id)
        values (${channel.workspace_id}, ${identity.name},
          ${identity.creature}, ${channel.agent_identity_updated_at},
          ${channel.name}, ${channel.agent_brief},
          ${channel.agent_brief_updated_at}, ${channel.agent_model},
          ${channel.container_audience === "members" ? channel.container_id : null},
          ${channel.creator_id})
        returning id`)
      if (!made) throw new Error(`No agent made for channel ${channel.id}`)
      await tx.execute(
        sql`update channel set agent_id = ${made.id} where id = ${channel.id}`
      )
    }

    let facts = 0
    if (hadFacts) {
      await tx.execute(sql`alter table channel_agent_fact rename to agent_fact`)
      await tx.execute(
        sql`alter table agent_fact add column agent_id uuid references agent(id) on delete cascade`
      )
      const moved = await tx.execute(sql`
        update agent_fact f set agent_id = c.agent_id
        from channel c where c.id = f.channel_id and c.agent_id is not null
        returning f.id`)
      facts = moved.length
      await tx.execute(sql`delete from agent_fact where agent_id is null`)
      await tx.execute(
        sql`alter table agent_fact alter column agent_id set not null`
      )
      await tx.execute(
        sql`alter table agent_fact alter column channel_id drop not null`
      )
    }

    console.log(
      `Agents from channels: ${channels.length} channel(s) got their own agent, ${facts} fact(s) moved.`
    )
    if (dryRun) throw new DryRun()
  })
}

try {
  await run()
} catch (err) {
  if (!(err instanceof DryRun)) throw err
  console.log("Dry run: rolled back, nothing changed.")
}
await closeDb()
