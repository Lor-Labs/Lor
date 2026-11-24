// Agents come off channels (reference/agents-and-chats.md, step 1). This
// moves what a `db:push` would otherwise drop:
//
// - every text channel's agent settings become an `agent` row, and the
//   channel holds it through `channel_agent` (the shape allows several);
// - facts move to the agent, scoped to the private container they were
//   learned in, so nothing private follows an agent out of a channel;
// - a brief written for an agent that only lives in private channels becomes
//   those channels' own instructions, since an agent's brief is public;
// - the workspace's autonomous-run settings are copied onto each of its
//   agents, which own them from here on.
//
// scripts/push.mjs runs this before every `pnpm db:push`. It works from the
// schema it finds: the original per-channel columns, or the first cut of
// this step (`channel.agent_id`). It runs once per database (the marker is
// the `channel_agent` table), in one transaction, and is a no-op after. Take
// it out of push.mjs once every environment has pushed.
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
  creator_id: string | null
  agent_name: string | null
  agent_creature: string | null
  agent_identity_updated_at: Date | null
  agent_brief: string | null
  agent_brief_updated_at: Date | null
  agent_model: string | null
  name: string | null
}

// The members-only container of a channel (itself or its category), else
// null: the scope of what an agent learns there.
const privateContainerOf = (channelAlias: string) =>
  sql.raw(`(
    select case
      when p.audience = 'members' then p.id
      when p.id is null and c0.audience = 'members' then c0.id
    end
    from channel c0 left join channel p on p.id = c0.parent_id
    where c0.id = ${channelAlias}
  )`)

class DryRun extends Error {}

// The original shape: the agent's settings are columns on its channel.
async function agentsFromChannelColumns(tx: Executor) {
  await tx.execute(sql`
    create table agent (
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
      created_by_id uuid references "user"(id) on delete set null
    )`)
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
      ${old("agent_name", "text")} as agent_name,
      ${old("agent_creature", "text")} as agent_creature,
      ${old("agent_identity_updated_at", "timestamp")} as agent_identity_updated_at,
      ${old("agent_brief", "text")} as agent_brief,
      ${old("agent_brief_updated_at", "timestamp")} as agent_brief_updated_at,
      ${old("agent_model", "text")} as agent_model
    from channel c
    where c.workspace_id is not null and (c.type = 'text' ${withFacts})
    order by c.created_at`)
  await tx.execute(
    sql`create temporary table agent_placement (channel_id uuid primary key, agent_id uuid not null) on commit drop`
  )
  for (const channel of channels) {
    // Seeded on the channel id: the name and face the team already sees.
    const identity = agentIdentityFor(channel.id, {
      name: channel.agent_name,
      creature: channel.agent_creature,
    })
    const [made] = await tx.execute<{ id: string }>(sql`
      insert into agent (workspace_id, name, creature, identity_updated_at,
        role, brief, brief_updated_at, model, created_by_id)
      values (${channel.workspace_id}, ${identity.name},
        ${identity.creature}, ${channel.agent_identity_updated_at},
        ${channel.name}, ${channel.agent_brief},
        ${channel.agent_brief_updated_at}, ${channel.agent_model},
        ${channel.creator_id})
      returning id`)
    if (!made) throw new Error(`No agent made for channel ${channel.id}`)
    await tx.execute(
      sql`insert into agent_placement (channel_id, agent_id) values (${channel.id}, ${made.id})`
    )
  }
  if (hadFacts) {
    await tx.execute(sql`alter table channel_agent_fact rename to agent_fact`)
    await tx.execute(
      sql`alter table agent_fact add column agent_id uuid references agent(id) on delete cascade`
    )
    await tx.execute(sql`
      update agent_fact f set agent_id = p.agent_id
      from agent_placement p where p.channel_id = f.channel_id`)
    await tx.execute(sql`delete from agent_fact where agent_id is null`)
    await tx.execute(
      sql`alter table agent_fact alter column agent_id set not null`
    )
    await tx.execute(
      sql`alter table agent_fact alter column channel_id drop not null`
    )
  }
  return channels.length
}

// The first cut of this step: one agent per channel in `channel.agent_id`.
async function placementsFromAgentId(tx: Executor) {
  await tx.execute(sql`
    create temporary table agent_placement on commit drop as
    select id as channel_id, agent_id from channel where agent_id is not null`)
}

async function run() {
  if (!(await tableExists(db, "channel"))) {
    console.log("Agents from channels: a new database, nothing to move.")
    return
  }
  if (await tableExists(db, "channel_agent")) {
    console.log("Agents from channels: already done.")
    return
  }

  await db.transaction(async (tx) => {
    const firstCut = await columnExists(tx, "channel", "agent_id")
    const made = firstCut ? 0 : await agentsFromChannelColumns(tx)
    if (firstCut) await placementsFromAgentId(tx)

    await tx.execute(sql`
      create table channel_agent (
        channel_id uuid not null references channel(id) on delete cascade,
        agent_id uuid not null references agent(id) on delete cascade,
        created_at timestamp not null default now(),
        added_by_id uuid references "user"(id) on delete set null,
        brief text,
        brief_updated_at timestamp,
        primary key (channel_id, agent_id)
      )`)
    const placed = await tx.execute(sql`
      insert into channel_agent (channel_id, agent_id)
      select channel_id, agent_id from agent_placement
      returning channel_id`)

    // An agent's brief is now readable by every member. One written for an
    // agent that only lives in private channels becomes those channels' own
    // instructions, and its role (the channel's name) is cleared.
    const moved = await tx.execute(sql`
      with private_agents as (
        select ca.agent_id
        from channel_agent ca
        group by ca.agent_id
        having bool_and(${privateContainerOf("ca.channel_id")} is not null)
      ), briefs as (
        update channel_agent ca
        set brief = a.brief, brief_updated_at = a.brief_updated_at
        from agent a
        where a.id = ca.agent_id and a.brief is not null
          and a.id in (select agent_id from private_agents)
        returning ca.agent_id
      )
      update agent a set brief = null, brief_updated_at = null, role = null
      where a.id in (select agent_id from private_agents)
      returning a.id`)

    let scoped = 0
    if (await tableExists(tx, "agent_fact")) {
      if (!(await columnExists(tx, "agent_fact", "scope_channel_id"))) {
        await tx.execute(
          sql`alter table agent_fact add column scope_channel_id uuid references channel(id) on delete cascade`
        )
      }
      const rows = await tx.execute(sql`
        update agent_fact f
        set scope_channel_id = ${privateContainerOf("f.channel_id")}
        where f.channel_id is not null
          and ${privateContainerOf("f.channel_id")} is not null
        returning f.id`)
      scoped = rows.length
      // A fact whose channel is gone keeps the scope its agent had.
      if (await columnExists(tx, "agent", "access_container_id")) {
        await tx.execute(sql`
          update agent_fact f set scope_channel_id = a.access_container_id
          from agent a
          where a.id = f.agent_id and f.channel_id is null
            and a.access_container_id is not null`)
      }
    }

    // Each agent takes its workspace's autonomous-run settings as its own.
    let copied = 0
    if (await tableExists(tx, "workspace_harness_settings")) {
      await tx.execute(sql`
        create table agent_harness_settings (
          agent_id uuid primary key references agent(id) on delete cascade,
          default_harness text not null default 'pi',
          claude_api_billing text not null default 'lor',
          codex_api_billing text not null default 'lor',
          claude_account_id uuid,
          codex_account_id uuid,
          claude_use_subscriptions boolean not null default false,
          codex_use_subscriptions boolean not null default false,
          claude_auto_fallback boolean not null default true,
          codex_auto_fallback boolean not null default true
        )`)
      const rows = await tx.execute(sql`
        insert into agent_harness_settings (agent_id, default_harness,
          claude_api_billing, codex_api_billing, claude_account_id,
          codex_account_id, claude_use_subscriptions,
          codex_use_subscriptions, claude_auto_fallback, codex_auto_fallback)
        select a.id, w.default_harness, w.claude_api_billing,
          w.codex_api_billing, w.claude_account_id, w.codex_account_id,
          w.claude_use_subscriptions, w.codex_use_subscriptions,
          w.claude_auto_fallback, w.codex_auto_fallback
        from agent a
        join workspace_harness_settings w on w.workspace_id = a.workspace_id
        returning agent_id`)
      copied = rows.length
      // The workspace's API model was the model of work nobody asked for.
      await tx.execute(sql`
        update agent a set model = w.api_model
        from workspace_harness_settings w
        where w.workspace_id = a.workspace_id and a.model is null
          and w.api_model is not null`)
    }

    console.log(
      [
        "Agents from channels:",
        firstCut
          ? `${placed.length} channel(s) keep their agent`
          : `${made} channel(s) got their own agent`,
        `${scoped} fact(s) kept private to where they were learned`,
        `${moved.length} private agent(s) had their brief moved to their channels`,
        `${copied} agent(s) took their workspace's run settings.`,
      ].join(" · ")
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
