# Agents and chats: agents apart from channels

**Status:** Decided with Jacob on 2026-11-23 and 2026-11-24, and built step
by step from §9. Step 1 (agents apart from channels) is built, 2026-11-24:
lint and type checks pass, the data move and the app were run on a throwaway
database, and `db:push` on the shared databases is owed (§9, rollout). Steps
2 to 5 are not started, so every chat with an agent in a channel still shares
that channel's one queue. It changes the shape built under
`always-on-agents.md` (LOR-169): where a step here has landed, this doc says
what the code does.

## 1. Why

`always-on-agents.md` made a channel one agent and one chat, with one queue
and one turn at a time. Jacob's team used it and hit three limits:

- **One conversation does not scale.** Ten people asking one agent wait on
  each other's turns and share one history, so follow-ups get mixed up.
- **Work gets lost.** A thread is found only by scrolling the channel to it.
  That is why sessions exist.
- **A channel is two things.** It is a place where people talk and it is the
  agent. Slack and Discord can replace the first, never the second, so a team
  that keeps its chat app could put an agent in one channel only.

Who it is for (Jacob, 11-23): first, teams that want team agents and keep
Slack or Discord. Second, and the long-term play, teams that use Lor as their
chat.

## 2. The terms

| Term | What it is | Where you find it |
|---|---|---|
| **Channel** | A long-lasting place where people talk, like `#eng`. In Lor, Slack or Discord. It has one agent or none | The sidebar, or the chat app |
| **Agent** | A teammate for a role, like eng or gtm. A team has a few. It carries its brief, tools, memory, accounts and events to every channel and chat | The sidebar |
| **Chat** | One piece of work between some people and one agent | Under its agent in the sidebar |
| **Session** | One coding agent on one branch, with a computer. Unchanged | Under its chat, or on its own when a person started it |
| **Thread** | Replies under a message in a channel. Unchanged | In the channel |

```
Agent ── added to ──> channels (in Lor, Slack or Discord)
  └── chats (one per piece of work)
        └── code sessions
```

"Chat" means only this. A channel's messages are the channel's messages.

## 3. Decisions

"Jacob" means he decided or agreed it. "Default" is a proposal he has not
objected to and should confirm.

| # | Decision | Status |
|---|---|---|
| 1 | Agents are their own thing, apart from channels, and are added to channels and chats | Jacob, 11-24 |
| 2 | A channel is only a place where people talk. In Lor it can have no agent | Jacob, 11-24 |
| 3 | A chat is one piece of work with one agent. It is its own object, not a thread, and the agent starts code sessions under it | Jacob, 11-24 |
| 4 | The word is "chat" | Jacob, 11-24 |
| 5 | A chat is quiet, not hidden: it lists and notifies only for the people in it, and anyone who can see the agent can open it | Jacob, 11-24 |
| 6 | Each agent has its own settings, including its own Claude Code and ChatGPT accounts | Jacob, 11-24 |
| 7 | A code session a person asked for is paid by that person's own plan first. The agent's own accounts are the backup | Jacob, 11-24 |
| 8 | No "wake on every message" setting. A mention or a reply wakes the agent, and its check-in reads the rest | Jacob, 11-24 |
| 9 | One agent per channel and per chat to start | Default |
| 10 | Each chat has its own queue and its own context. Chats run side by side, one turn at a time inside each | Default |
| 11 | A quick question in a channel gets a plain reply there. A mention that is work becomes a chat | Default |
| 12 | Nothing to do when a chat is done. It sinks down the list and a new message brings it back | Default |
| 13 | A chat lives where it was started: in Lor, or in a Slack or Discord thread. No two-way sync | Default |
| 14 | An agent has one audience, the whole workspace or named members. Everything it hears is open to that audience, so a private channel needs an agent only its members can see | Default |
| 15 | An event or Loop belongs to an agent and names the channel it reports in | Default |
| 16 | Accounts are owned by the workspace and each agent picks its own, so two agents can share one and deleting an agent deletes none | Default |
| 17 | The agent's own turns run on the API. A plan pays only for code sessions | Default |
| 18 | No signup question about where the team chats. Linking a channel to a chat app already decides it, per channel | Default |

Considered and dropped:

- **A chat as a thread on a channel.** A thread is lost as the channel moves
  on, and a chat started in Lor or in a DM to the agent has no channel.
- **A chat built on group DMs.** A group DM is its own container with a member
  list, so it is hidden, not quiet.
- **A private chat per person.** It solves the queue and loses the shared
  record, which is the reason to use Lor over a personal agent.
- **Numbered copies of an agent (eng2, eng3).** They split memory arbitrarily.

## 4. How it works

**In a channel**

1. Sam writes in `#eng`: "@Inky the login redirect loops on Safari, can you
   fix it".
2. Inky answers under that message, which starts a chat. The chat shows as a
   thread in `#eng` and under Inky in Sam's sidebar.
3. Inky starts a code session, shown as a card in the chat.
4. Jacob opens the thread and writes in it. The chat is now in his sidebar.
5. Eli asks Inky for something else. That is a second chat, and it runs at the
   same time.

- A channel with no agent is plain human chat. Nothing wakes on it.
- The agent reads along in its channels. Messages not for it wait unread until
  its check-in, as today.
- In a chat every message reaches the agent, and it may stay quiet.

**With no channel**

- New chat in Lor: pick the agent, say what you need. Only you are in it.
- A DM to the agent in Slack or Discord is a chat with no channel.

**In Slack or Discord**

- Adding the agent to a channel there makes a read-only copy in Lor, so the
  record and search work. Nobody creates channels in Lor.
- A thread with the agent there is a chat in Lor, listed under the agent.
- The agent links to Lor only for what a chat app cannot hold: a session's
  browser, diff and terminal.

**People in a chat**

- You start it and you are in it. Writing in it, being mentioned or being
  added puts someone else in. This is how thread subscriptions already work.

**Work nobody asked for**

- An event or a Loop wakes the agent. What it posts goes to the channel that
  event names, and a reply to it becomes a chat.
- The chat never says what woke the agent (`always-on-agents.md`, decision 30).

## 5. The agent's settings

| Section | What it holds | Where it sits today |
|---|---|---|
| Identity | Name, face | The channel |
| Brief and memory | The brief (only people edit it), facts | The channel |
| Its own turns | Model. Who pays: Lor credits or the workspace's API key | The channel (model), workspace settings (payer) |
| Code sessions | Its Claude Code and Codex accounts with their order, and the repos it may use | Workspace settings, "Lor's autonomous runs" |
| Tools | Connectors, read and write access. Writes follow the approval rules | A tool profile on the channel or its category |
| Channels | The channels it is in, in Lor, Slack and Discord | The channel |
| Events and Loops | Each with the channel it reports in. Also the check-in | The channel |
| Who can see it | The whole workspace, or named members | New |

**Who pays for a code session** (decision 7), tried in order:

1. The plan of whoever asked, when they have one connected.
2. The agent's own accounts. They also pay for work nobody asked for, when an
   admin has turned that on.
3. The API, paid the same way as the agent's own turns.

Most of this is `reference/harness-accounts.md` (built 2026-11-22) with the
workspace's "Lor's autonomous runs" page moved onto each agent. Its caveat
stands: a dedicated subscription does not by itself give permission to
automate it, so the API stays the default and a plan is an explicit choice.

## 6. The sidebar

```
Needs you                              only while something waits
Agents
  Inky  Eng
    Login redirect loop on Safari      a chat you are in
      web · fix/login-redirect         its session
  Quill  GTM
Channels
  # general
  # eng          Inky is here
  # gtm          Quill is here
```

The agent's page lists everyone's chats with it. Yours are also in the
sidebar.

## 7. What changes in what is built

| Piece | Today | Becomes |
|---|---|---|
| Agent record | Columns on the channel: name, face, brief, model, wake mode | Its own record. A channel records which agent is in it, or none |
| Facts, the log, the open block | Per channel | Per agent |
| Events, webhooks, Loops, wake-ups, the check-in | Per channel | Per agent, each with a channel to report in |
| The agent's history and queue | One per channel (`agent_step`, `agent_context`, one active run per channel) | One per chat, and one per channel the agent is in for reading along |
| A session's report | Wakes the channel's one conversation | Wakes the chat that started it |
| Chat | None. Threads the agent answers in share the channel's queue | A record like a session's (a hidden anchor message, a title, its people, an archive date) with no repo or coding agent |
| Wake mode | Per channel: mentions, or every message | Mentions only. The setting goes |
| Discord link | One Lor channel to one Discord channel | One agent in many Discord channels, each copied to a Lor channel |
| Accounts for work nobody asked for | Workspace settings | Picked per agent |
| Session ceiling | 15 at once per channel | Per agent, and higher: 15 is too low for ten people |
| Sidebar | Channels, each with its agent's face and your sessions | Agents with your chats, then channels |

Existing channels would not change on the day this lands: each channel's
agent becomes its own agent, already added to that channel. A team can then
add one agent to more channels and remove the ones it does not want.

This replaces decisions 1, 2, 8 and 32 of `always-on-agents.md` and changes
15, 17, 19, 22, 26 and 37. The inbox, the two lanes, `send_message`,
`wake_up`, the memory pass, compaction, the agent's own loop and sessions as
tools all stay.

## 8. Open

- **Two chats starting the same work.** The open block narrows it and does not
  close it.
- **Several agents in one chat or channel.** Wanted later ("agents messaging
  each other"). It brings back the question of who answers.
- **The agent's own computer** (`always-on-agents.md`, decision 36). One
  watchable computer assumes one thing happening at a time. With chats side by
  side it needs a computer per chat, or a queue for the one.
- **Slack.** For teams that keep their chat app it is the larger half of the
  work, and it is not started. Discord exists.
- **Provider terms** for one agent's subscription used by a whole team. Not
  checked for OpenAI.
- **Does the chat earn its place?** Chat sessions were dropped on 11-18 as
  barely used. New session stays a direct way to a coding agent.

## 9. Build steps

Each step ends in something the team uses. Steps 2 to 5 are not sized.

### Step 1: agents apart from channels (built 2026-11-24)

- [x] **`agent` table** (`packages/db/src/schemas/agents.ts`): name, creature,
  role, brief, model, `access_container_id` (who can see it), creator.
  `channel.agent_id` points at it, or is null.
- [x] **Off the channel:** `agent_name`, `agent_creature`,
  `agent_identity_updated_at`, `agent_brief`, `agent_brief_updated_at`,
  `agent_model`, and `agent_wake_mode` with its enum (decision 8).
  `agent_check_in_at` and `agent_profile_id` stay.
- [x] **Facts per agent:** `channel_agent_fact` is `agent_fact`, keyed by
  `agent_id`. `channel_id` stays as where a fact was learned. The cap (100
  facts, 4,000 characters) and the write lock are per agent.
- [x] **The data move** (`packages/db/src/scripts/agents-from-channels.ts`):
  every text channel's agent settings become an `agent` row with the name and
  face people already see, and its facts follow. `scripts/push.mjs` runs it
  before every `db:push`, because that push drops the old columns. It runs
  once per database, in one transaction, and is a no-op after.
- [x] **Turns:** the worker loads the agent through `channel.agent_id`
  (`loadAgentChannel` in `apps/worker/src/lib/agent-inbox.ts`). The prompt
  header names the other channels the agent is in and says each channel is
  its own conversation. Profile change notes reach every channel of an agent.
- [x] **No agent in a channel:** nothing is queued (`addInboxMessage` and
  `addInboxNote` refuse), no check-in Loop is made, a Loop fire or an event
  there is skipped, and nothing answers a mention.
- [x] **Mentions only:** the "every message" wake mode is gone from realtime,
  Discord inbound, the worker and the payer rule.
- [x] **A different agent in a channel** starts a fresh conversation there
  (`resetAgentConversation`), and the channel gets its check-in when its
  first agent is added.
- [x] **API:** `/v1/workspaces/:slug/agents` (list, create, change, delete)
  and `/agents/:id/facts`. The channel routes take `agentId` and lose the
  agent fields and the fact routes. New event `agents:updated`.
- [x] **New channels:** left unpicked, a text channel gets the workspace's
  first agent with its audience. A new workspace starts with one agent in
  every text channel. A new private channel or project starts with none.
- [x] **Audience rule** (decision 14): an agent is the whole workspace's or
  one members-only container's, and can be added only to channels with that
  audience. Checked on the server.
- [x] **Web:** a channel's Agent tab picks the agent, or none, and edits that
  agent's own settings; workspace settings has an Agents section (make, edit,
  delete, see where each is). The sidebar, mentions, hints and empty states
  follow a channel with no agent.
- [x] **Mobile:** follows the same data. No agent picker there: a channel's
  agent is picked on web.
- [x] **Checked 2026-11-24** on a throwaway Postgres: the old schema pushed
  and seeded (a picked name, derived names, a replaced creature, a private
  category, facts), then `pnpm db:push`. Every agent kept the name and face
  the old code showed, the private channel's agent became private to its
  category, facts followed their agent, and a second push found nothing of
  this step to change. In the app: one agent in two channels, a channel with
  no agent (nothing queued, no agent offered as a mention), the Agents
  section (make, rename, delete), and a live turn in a second channel that
  answered from a fact learned in the first.

Deviations and gaps:

- **Tools stay on the channel.** A turn uses the tool profile of the channel
  it runs in, as before, so one agent can have different tools in two
  channels. §5 moves them to the agent; not done.
- **Events and Loops stay on the channel** they report in, and the channel's
  agent handles them. They do not move with an agent that leaves.
- **The log and the open block are per channel.** An agent in three channels
  does not see, in one, what is running in the others. Its facts are how
  anything crosses.
- **The session ceiling** is still 15 per channel.
- **Permissions:** managing agents takes `channel:update`, the permission the
  channel's agent settings took. The person who made an agent can still
  rename it and change its face and role.
- **The sidebar still lists channels only.** Agents get their own group with
  chats under them in step 2.
- **The mock's settings page** shows accounts, audience and events on the
  agent. None of those are built.
- **No audience picker yet.** A new agent made from a private channel's
  settings is private to it; one made in workspace settings is the whole
  workspace's. Changing an agent's audience is not built.

Rollout, per environment, with API, realtime, worker, web and mobile together:

1. `pnpm db:push`. It runs the data move first, then drops the old columns
   (drizzle-kit asks before dropping; `--force` skips the question).
2. Restart the workers, so no turn runs on old code.
3. Rebuild web, desktop and mobile: the channel payload changed shape.
4. Once every environment has pushed, take `agents-from-channels.ts` out of
   `BEFORE_PUSH` in `packages/db/scripts/push.mjs`.

### Step 2: chats

The chat record, a queue and context per chat, a mention that is work
starting one, New chat, session reports going back to their chat, and the
sidebar's Agents group. The log and the open block become the agent's.

### Step 3: accounts per agent

The payer order of §5, and tools on the agent.

### Step 4: Discord in this shape

One agent in many channels works after step 1 through several Lor channels.
Still to do: a thread as a chat, and DMs to the agent.

### Step 5: Slack

In the same shape.

## 10. The mock

`/prototype/agents` (dev only, made-up data,
`apps/web/src/components/prototype/agents/`) shows this shape: the sidebar,
a channel with and without an agent, a channel that lives in Slack, a mention
becoming a chat, a chat with its sessions, New chat, and the agent's settings.
`/prototype/orchestration` still shows the earlier thread-based shape.
