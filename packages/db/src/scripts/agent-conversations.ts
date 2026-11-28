// An agent's inbox, steps, context and wake-ups move from the channel to a
// conversation (reference/agents-and-chats.md, decision 28, step 3).
//
// scripts/push.mjs runs this before every `pnpm db:push`. The push alone
// can't make the change: it would add `conversation_id not null` to tables
// that have rows, and for `agent_step` and `agent_context` it would ask
// whether `channel_id` was renamed. Once per database (the marker is the
// `agent_conversation` table), in one transaction:
//
// - each channel's conversation so far becomes a conversation of the agent
//   now in that channel, kept to read (`read_agent_history`): no new message
//   is routed to it. A channel with no agent loses its stored turns;
// - what waited unread goes to that agent's own conversation, and so do its
//   pending wake-ups;
// - check-in Loops are deleted: the check-in is automatic now (decision 26).
//
// Stop the workers first: a turn running during the move would write to
// columns that are going away. Take this out of push.mjs once every
// environment has pushed.
//
//   pnpm --filter @repo/db exec tsx src/scripts/agent-conversations.ts \
//     [--dry-run]
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

class DryRun extends Error {}

async function run() {
  if (!(await tableExists(db, "agent_step"))) {
    console.log("Agent conversations: a new database, nothing to move.")
    return
  }
  if (await tableExists(db, "agent_conversation")) {
    console.log("Agent conversations: already done.")
    return
  }
  if (!(await tableExists(db, "channel_agent"))) {
    throw new Error(
      "Agent conversations: run agents-from-channels.ts first (push.mjs does)."
    )
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`create type agent_conversation_kind as enum ('own', 'request')`
    )
    await tx.execute(sql`
      create table agent_conversation (
        id uuid primary key default gen_random_uuid(),
        created_at timestamp not null default now(),
        workspace_id uuid not null references workspace(id) on delete cascade,
        agent_id uuid not null references agent(id) on delete cascade,
        kind agent_conversation_kind not null,
        channel_id uuid references channel(id) on delete cascade,
        root_message_id uuid references message(id) on delete cascade,
        started_by_id uuid references "user"(id) on delete set null,
        checked_in_at timestamp,
        last_activity_at timestamp not null default now()
      )`)
    await tx.execute(sql`
      create table agent_request_post (
        message_id uuid primary key references message(id) on delete cascade,
        conversation_id uuid not null
          references agent_conversation(id) on delete cascade
      )`)

    // The agent now in each channel (the first one added).
    await tx.execute(sql`
      create temporary table channel_first_agent on commit drop as
      select distinct on (ca.channel_id) ca.channel_id, ca.agent_id,
        a.workspace_id
      from channel_agent ca join agent a on a.id = ca.agent_id
      order by ca.channel_id, ca.created_at, ca.agent_id`)

    // One own conversation per agent that is in a channel.
    await tx.execute(sql`
      insert into agent_conversation (workspace_id, agent_id, kind)
      select distinct workspace_id, agent_id,
        'own'::agent_conversation_kind
      from channel_first_agent`)
    // A channel's conversation so far, kept to read.
    const kept = await tx.execute(sql`
      insert into agent_conversation
        (workspace_id, agent_id, kind, channel_id, created_at, last_activity_at)
      select f.workspace_id, f.agent_id, 'request', f.channel_id,
        coalesce(min(s.created_at), now()), coalesce(max(s.created_at), now())
      from channel_first_agent f
      join agent_step s on s.channel_id = f.channel_id
      group by f.workspace_id, f.agent_id, f.channel_id
      returning id`)
    await tx.execute(sql`
      create temporary table channel_conversation on commit drop as
      select f.channel_id, f.agent_id,
        (select c.id from agent_conversation c
          where c.agent_id = f.agent_id and c.kind = 'own') as own_id,
        (select c.id from agent_conversation c
          where c.channel_id = f.channel_id and c.kind = 'request') as kept_id
      from channel_first_agent f`)

    // Steps and their context follow the channel's kept conversation.
    const lost = await tx.execute(sql`
      delete from agent_step s
      where not exists (
        select 1 from channel_conversation c
        where c.channel_id = s.channel_id and c.kept_id is not null
      )
      returning s.id`)
    await tx.execute(sql`
      alter table agent_step add column conversation_id uuid
        references agent_conversation(id) on delete cascade`)
    await tx.execute(sql`
      update agent_step s set conversation_id = c.kept_id
      from channel_conversation c where c.channel_id = s.channel_id`)
    await tx.execute(
      sql`alter table agent_step alter column conversation_id set not null`
    )
    await tx.execute(sql`alter table agent_step drop column channel_id`)

    await tx.execute(sql`
      delete from agent_context x
      where not exists (
        select 1 from channel_conversation c
        where c.channel_id = x.channel_id and c.kept_id is not null
      )`)
    await tx.execute(sql`
      alter table agent_context add column conversation_id uuid
        references agent_conversation(id) on delete cascade`)
    await tx.execute(sql`
      update agent_context x set conversation_id = c.kept_id
      from channel_conversation c where c.channel_id = x.channel_id`)
    await tx.execute(sql`alter table agent_context drop column channel_id`)
    await tx.execute(
      sql`alter table agent_context add primary key (conversation_id)`
    )

    // Read items stay with the channel's history; what still waits goes to
    // the agent's own conversation.
    await tx.execute(sql`
      delete from agent_inbox i
      where not exists (
        select 1 from channel_conversation c where c.channel_id = i.channel_id
      )`)
    await tx.execute(sql`
      alter table agent_inbox add column conversation_id uuid
        references agent_conversation(id) on delete cascade`)
    await tx.execute(sql`
      update agent_inbox i
      set conversation_id = case
        when i.status = 'pending' then c.own_id
        else coalesce(c.kept_id, c.own_id)
      end
      from channel_conversation c where c.channel_id = i.channel_id`)
    // Two channels of one agent can't hold the same source item twice.
    await tx.execute(sql`
      delete from agent_inbox i using agent_inbox other
      where i.conversation_id = other.conversation_id
        and i.source = other.source and i.source_id = other.source_id
        and i.id > other.id`)
    await tx.execute(
      sql`alter table agent_inbox alter column conversation_id set not null`
    )
    await tx.execute(sql`drop index if exists agent_inbox_channel_source_uidx`)
    await tx.execute(sql`drop index if exists agent_inbox_channel_pending_idx`)

    await tx.execute(sql`
      delete from agent_wake_up w
      where not exists (
        select 1 from channel_conversation c where c.channel_id = w.channel_id
      )`)
    await tx.execute(sql`
      alter table agent_wake_up add column conversation_id uuid
        references agent_conversation(id) on delete cascade`)
    await tx.execute(sql`
      update agent_wake_up w set conversation_id = c.own_id
      from channel_conversation c where c.channel_id = w.channel_id`)
    await tx.execute(
      sql`alter table agent_wake_up alter column conversation_id set not null`
    )

    // The agent's own turns so far: runs that hold their channel as scope.
    await tx.execute(sql`
      alter table agent_run add column conversation_id uuid
        references agent_conversation(id) on delete set null`)
    await tx.execute(sql`
      update agent_run r set conversation_id = c.kept_id
      from channel_conversation c
      where r.scope_key = r.channel_id and c.channel_id = r.channel_id
        and c.kept_id is not null`)

    const checkIns = await tx.execute(
      sql`delete from loop where kind = 'check_in' returning id`
    )

    console.log(
      [
        "Agent conversations:",
        `${kept.length} channel conversation(s) kept to read`,
        `${lost.length} stored step(s) of channels with no agent dropped`,
        `${checkIns.length} check-in Loop(s) deleted.`,
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
