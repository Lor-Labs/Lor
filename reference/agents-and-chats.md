# Agents and chats: agents apart from channels

**Status:** Decided with Jacob from 2026-11-23 to 11-26 and built step by
step from §9. This doc is the record: §3 lists every decision (1 to 43) with
who made it and when, §9 says what each step built, how it was checked and
what was not run, and "What is left" at the top of §9 is the order of the
remaining work. Built so far: agents apart from channels (step 1), one
memory per agent (step 2), and of step 3 the conversations backend, several
agents in a chat posting as bot users, the Jev wake for messages that name
nobody, the sidebar's chat list with its member records, listeners (several
agents per connector event, custom webhooks on the agent's page), the
notification rules, New chat and the chat's header and panel. Left in step 3:
finding and joining a chat, agents messaging each other, and Loops stored on
the agent. Steps 4 and 5 are design only. Lint and type checks pass and each
part was run live on a throwaway database, except where its section says
otherwise. `db:push` on the shared databases is owed (§9, rollout). It
changes the shape built under `always-on-agents.md` (LOR-169): where a step
here has landed, this doc says what the code does.

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
| **Agent** | A teammate for a role, like eng or gtm. A team has a few. It owns its brief, tools, memory, accounts, loops and places, and is the same in all of them | The right panel of a channel it is in |
| **Place** | A channel an agent is in: in Lor, Slack or Discord. One in Slack or Discord is stored for the agent and is not a Lor channel | The agent's dialog |
| **The agent's own conversation** | The one conversation an agent has with itself, for what nobody asked for: the check-in, loops, events and its own wake-ups. Nobody talks to it there | Nowhere; what it posts lands in a channel |
| **Chat** | One piece of work between some people and one agent, with its own conversation | The sidebar |
| **Session** | One coding agent on one branch, with a computer. Unchanged | Under its chat, or on its own when a person started it |
| **Thread** | Replies under a message in a channel. Unchanged | In the channel |

```
Agent ── added to ──> places (channels in Lor, Slack or Discord)
  ├── its own conversation (check-in, loops, events)
  └── chats (one per request)
        └── code sessions
  one memory under all of them: facts, a journal, its history
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
| 7 | What a person asks for is paid by that person's own plan first. The agent's own accounts are the backup, and pay for work nobody asked for | Jacob, 11-24 |
| 8 | No "wake on every message" setting. A mention or a reply wakes the agent, and its check-in reads the rest | Jacob, 11-24 |
| 9 | The data allows several agents in a channel. The app holds a channel to one until each has its own conversation there (step 2). One agent per chat | Jacob, 11-24 |
| 10 | Each chat has its own queue and its own context. Chats run side by side, one turn at a time inside each | Default |
| 11 | A quick question in a channel gets a plain reply there. A mention that is work becomes a chat | Default |
| 12 | Nothing to do when a chat is done. It sinks down the list and a new message brings it back | Default |
| 13 | A chat lives where it was started: in Lor, or in a Slack or Discord thread. No two-way sync | Default |
| 14 | No private agents. Every member sees every agent, and any agent can be in any channel. A channel's instructions for it live on that channel. The first form of this decision also kept what it learns in a private channel there by scope; decision 22 replaced that | Jacob, 11-24 |
| 15 | An event or Loop belongs to an agent. Where it posts is optional (decision 27) | Jacob, 11-24 |
| 16 | Accounts are owned by the workspace and each agent picks its own, so two agents can share one and deleting an agent deletes none. The workspace's "Autonomous runs" section is gone: the settings are each agent's | Jacob, 11-24 |
| 17 | An agent runs as Lor on a model, or on Claude Code or Codex, for its own turns and the sessions it starts. A plan can pay for either (the first cut of this doc said only for sessions, which was wrong) | As built 11-22 |
| 18 | No signup question about where the team chats. Linking a channel to a chat app already decides it, per channel | Default |
| 19 | A channel's agents are at the top of its right panel, and nowhere else on the channel: no agent in its header, and no face on its row in the sidebar, since a channel can hold several. A row opens that agent's dialog. A channel with room shows an Add agent row; a full one shows a button on the agent's row that swaps it, so nothing offers to add where the app would replace. The left sidebar is for chats and channels only. It replaced an Agents group in the left sidebar, built earlier the same day | Jacob, 11-24 |
| 20 | An agent's settings are in its own dialog. A channel's dialog says which agent is in it and what the team wants from it there | Jacob, 11-24 |
| 21 | A channel's loops are listed in its agent's dialog, under Loops, and not in the channel's right panel: each fire wakes that channel's agent, so they are that agent's. A loop is still stored on its channel (`loop.channel_id`) until step 3 moves it to the agent (decision 15), so a channel that swaps its agent hands its loops to the new one. A channel with no agent still lists its own loops in its right panel, where nothing runs them | Jacob, 11-24 |
| 22 | No privacy promise inside an agent. Everything an agent knows is shared with the whole workspace and used wherever it works. A private channel that must stay private gets its own agent; the app does not say so. A new private channel starts with no agent, so putting one in is a choice | Jacob, 11-24 |
| 23 | An agent owns everything it has: brief, tools, memory, loops and places. Nothing is stored on a channel except the team's instructions for the agent there | Jacob, 11-24 |
| 24 | A Slack or Discord channel an agent is in is a place on the agent. Its messages are stored, since the agent's inbox and history need them, and it is not shown as a Lor channel. It is managed from the agent's dialog | Jacob, 11-24 |
| 25 | One memory under every conversation, so it is the same agent in a channel, a chat, a code session, Slack and Discord: facts in every prompt, a dated journal of what it did and heard, and the ability to read any of its conversations word for word. No shared transcript | Jacob, 11-24 |
| 26 | The check-in is automatic and hidden: about every 15 minutes, skipped when nothing is unread, reading every place the agent is in. It is not a Loop and has no setting | Jacob, 11-24 |
| 27 | A Loop is work the agent was told to do on a schedule: when, what, some context, and optionally where to post. It runs in the agent's own conversation, and the agent starts a chat or a session itself when the work is heavy | Jacob, 11-24 |
| 28 | The agent has one conversation of its own, for what nobody asked for (decisions 26 and 27, events, its wake-ups). Anything a person addresses to it runs in its own conversation, side by side with the others, so nobody waits behind background work or another person. A quick reply stays a thread; one that turns into work is listed as a chat | Jacob, 11-24 |
| 29 | Tools belong to the agent, not to the channel it is working in | Jacob, 11-24 |
| 30 | A fact the agent drops to make room is archived and stays searchable. It can save a fact during a turn, not only after one | Jacob, 11-24 |
| 31 | Lor is named group chats: people and agents in a chat with a name, and nothing else to start with (no statuses, kinds of chat or projects). Chats replace channels in the app. A chat is a text channel (`channel.kind = "chat"`), and the kind is kept so long-lived channels can come back later without a new table. Teams keep talking in Slack or Discord; Lor is where the agents and their work are | Jacob, 11-25 |
| 32 | A chat can hold several agents. A message that names an agent is answered by it at once. One that names nobody goes to the inbox of every agent in the chat, and an agent that finds it meant for it at its next check-in answers then (decision 26) | Jacob, 11-25 |
| 33 | The sidebar is chats: pinned ones first, then the rest by last message. A chat's code sessions are listed under it, and sessions keep the look and behaviour they have today | Jacob, 11-25 |
| 34 | Slack comes after chats are built | Jacob, 11-25 |
| 35 | Every chat is open and hidden: it is in the sidebar only of the people in it, and anyone else in the workspace can find it and join | Jacob, 11-25 |
| 36 | Hiding a chat puts it away for that person only. Archiving it for everyone stays a separate, rare action. Pins are each person's own | Jacob, 11-25 |
| 37 | Each agent gets a bot user of its own in place of all agents posting as the one Lor user. It is the next thing built, before the chat list | Jacob, 11-25 |
| 38 | A chat message that names no agent is judged at once (Jev, LOR-171): an agent it reads as meant for, from what was said before, its role, what it is working on and who wrote it, is woken now and not at its check-in. The agent may still stay quiet. A mention or a reply wakes as before | Jacob, 11-25 |
| 39 | Agents messaging each other get no rules about who may message whom. They are prompted to write to another agent only when the work needs it and not to answer for the sake of answering, and the same wake rule applies to them: named wakes, otherwise decision 38 decides | Jacob, 11-25 |
| 40 | An incoming event is heard by an agent, not kept on a channel: it is stored for the workspace (`source`, visible to everyone for now), delivered to the agent that listens for it, and the agent says what matters in a chat. A listener is one event with the agent that hears it, the chat that agent reports in, an optional plain-language filter checked by Jev, and an optional post of the raw event into that chat. For built-in connectors it is set up on the connector's page, with the fitting agent suggested by a model; an activity list is there but out of the way. Listeners defined by agents themselves, new sources and filters as code come later | Jacob, 11-26 |
| 41 | Notifications: a chat's message notifies the people in it; a posted event pings people only when its listener says so; what an agent says to a Lor chat pings like anyone's message; a thread's reply is unread only for the people who follow it; a chat that lives in Slack or Discord shows unread in Lor and leaves the ping to that app | Jacob, 11-26 |
| 42 | Several agents can listen to one event, each once and each with its own chat, filter and instructions. The connector's page shows events as a plain list, one line an event with who hears it; opening an event shows its listeners as chips and one flat form for the picked one | Jacob, 11-26 |
| 43 | A listener has no hourly or daily cap on how often it wakes its agent, shown or hidden: nothing limits it that the person cannot see. The filter turns events away and the inbox batches bursts | Jacob, 11-26 |

Considered and dropped:

- **A chat as a thread on a channel.** A thread is lost as the channel moves
  on, and a chat started in Lor or in a DM to the agent has no channel.
- **A chat built on group DMs.** A group DM is its own container with a member
  list, so it is hidden, not quiet.
- **A private chat per person.** It solves the queue and loses the shared
  record, which is the reason to use Lor over a personal agent.
- **One conversation for everything, with helpers for heavy work** (how a
  personal bot does it). One queue is right for one owner. With ten people
  it is the wait this doc started from.
- **Keeping what an agent learns in a private channel there** (built in
  step 1, decision 14's first form). It can't hold once the agent has one
  memory and one conversation of its own, and a promise that mostly holds is
  worse than none.
- **Numbered copies of an agent (eng2, eng3).** They split memory arbitrarily.

## 4. How it works

**In a channel**

1. Sam writes in `#eng`: "@Inky the login redirect loops on Safari, can you
   fix it".
2. Inky answers under that message, which starts a chat. The chat shows as a
   thread in `#eng` and in Sam's sidebar.
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

- Adding the agent to a channel there makes it one of the agent's places
  (decision 24). Its messages are stored so the agent can read and search
  them. It is not a channel in Lor's sidebar.
- A thread with the agent there is a chat in Lor.
- The agent links to Lor only for what a chat app cannot hold: a session's
  browser, diff and terminal.

**People in a chat**

- You start it and you are in it. Writing in it, being mentioned or being
  added puts someone else in. This is how thread subscriptions already work.

**Work nobody asked for**

- The check-in, a Loop or an event wakes the agent in its own conversation
  (decision 28). What it posts goes to the place the work names or the one
  it concerns, and a reply to it becomes a chat.
- The chat never says what woke the agent (`always-on-agents.md`, decision 30).

## 5. The agent's settings

| Section | What it holds | Where it sits today |
|---|---|---|
| Identity | Name, face | The channel |
| Brief and memory | The brief (only people edit it), facts | The channel |
| Runs | Its model, what it runs on (Lor, Claude Code or Codex), and which of the workspace's accounts pay when no person's plan does | The channel (model), workspace settings (the rest) |
| Tools | Connectors, read and write access. Writes follow the approval rules | A tool profile on the channel or its category |
| Channels | The channels it is in, in Lor, Slack and Discord | The channel |
| Loops and events | What it was told to do on a schedule or on an event, each with an optional place to post. The check-in is not here (decision 26) | The channel |
| Who can see it | Everyone in the workspace, and everything it knows (decision 22) | New |

**Who pays** (decision 7), for an agent's own turn and for a session it
starts:

1. The plan of whoever asked, when they linked one or picked how their
   requests run.
2. Else the agent's own settings (`agent_harness_settings`): what it runs on,
   and for Claude Code and Codex either the API or one of the workspace's
   accounts. They also pay for work nobody asked for.
3. With nothing set, Lor's own agent on Lor credits, on the agent's model.

The resolvers are `reference/harness-accounts.md`'s, read per agent. Its
caveat stands: a subscription connected for agents does not by itself give
permission to automate it, so the API stays the default and a plan is an
explicit choice.

## 6. The sidebar

```
Needs you                              only while something waits
Chats
  Login redirect loop on Safari        a chat you are in, with Inky
    web · fix/login-redirect           its session
Channels                               for a team that uses Lor's channels
  # general
  # eng
  # gtm
```

Superseded by decision 33 (2026-11-25): the sidebar is chats only, pinned
first and the rest by last message, as built under "The chat list" in
section 9. The sketch above is the earlier plan.

The sidebar holds chats and channels, not agents (decision 19). A channel's
agents are at the top of its right panel, with the row that adds one. The
agent's page lists everyone's chats with it. Yours are also in the sidebar.

## 7. What changes in what is built

| Piece | Today | Becomes |
|---|---|---|
| Agent record | Columns on the channel: name, face, brief, model, wake mode | Its own record. A channel records which agent is in it, or none |
| Facts, the log, the open block | Per channel | Per agent, with a journal and an archive under the facts (decisions 25 and 30) |
| Events, webhooks, Loops, wake-ups | Per channel | Per agent, each with an optional place to post |
| The check-in | A Loop on each channel | Automatic and hidden, one per agent (decision 26) |
| The agent's history and queue | One per channel (`agent_step`, `agent_context`, one active run per channel) | One of its own per agent, and one per chat (decision 28) |
| A session's report | Wakes the channel's one conversation | Wakes the chat that started it |
| Chat | None. Threads the agent answers in share the channel's queue | A record like a session's (a hidden anchor message, a title, its people, an archive date) with no repo or coding agent |
| Wake mode | Per channel: mentions, or every message | Mentions only. The setting goes |
| Discord link | One Lor channel to one Discord channel | One agent in many Discord channels, each a place on the agent (decision 24) |
| Accounts for work nobody asked for | Workspace settings | Picked per agent |
| Session ceiling | 15 at once per channel | Per agent, and higher: 15 is too low for ten people |
| Sidebar | Channels, each with its agent's face and your sessions | Your chats, then channels. No agent faces: a channel's agents are in its right panel |

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
- **Agents messaging each other.** Not built: agents in one chat do not
  wake each other. Shaped by Jacob on 2026-11-25 and mocked in
  `/prototype/chats` (Launch crew): a chat has an agents' chat about its
  work, which people read and don't write in. When one agent messages
  another, a quiet centered line of its own appears in the chat's feed at
  that moment ("Quill messaged Inky"; not under a message, so it is not a
  thread). It opens the agents' chat in place of the chat: bubbles, the
  agents' faces in the header, a Read-only mark where the composer would
  be, and a way back. It is also always reachable from the chat's panel.
  No caps and no rules about who may message whom (decision 39; the three
  rules proposed earlier that day are dropped): prompting, and the wake
  rule of decision 38, which `classifyInboxMessage` already applies to any
  author. What bounds it is what bounds any turn: spend, and a person
  stopping it. It is shown in Lor only: nothing about it is posted to a
  Slack or Discord thread (Jacob, 11-25).
- **A session of your own,** one you sit in yourself with no agent watching
  and no chat around it. The mock lists them in a Sessions section between
  Pinned and Recent.
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

**What is left** (the order agreed with Jacob on 2026-11-26; New chat and
the chat's header and panel were first and are built, see below):

1. Find and join a chat; then `channel-list.tsx` and the old create dialog
   are deleted. Joining itself is built (the panel's Join chat); what is
   missing is a place to find the chats you are not in.
2. Agents messaging each other (§8): the tool, the agents' chat, the
   "messaged" line and the read-only view, in Lor only.
3. Loops stored on the agent.
4. Slack and Discord as places (steps 4 and 5 below).

Beside these: "Needs you" in the sidebar (a group from the channel days;
not in the mock, and proposed to Jacob on 11-26 to go, with a pending
approval marked on its chat's row instead); the chat's settings dialog
(tools, webhooks) still says "channel"; no private chat can be made from
the web app (Jacob, 11-26: no switch for now); the mobile app still lists
channels; listeners an agent
proposes for itself; `db:push` on the shared databases, then API, realtime,
worker and web deployed together.

### Step 1: agents apart from channels (built 2026-11-24)

- [x] **`agent` table** (`packages/db/src/schemas/agents.ts`): name, creature,
  role, brief, model, creator.
- [x] **`channel_agent`**: which agents are in which channel, with the team's
  instructions for that agent in that channel (`brief`). The shape allows
  several; `MAX_CHANNEL_AGENTS` (`packages/db/src/constants.ts`) holds a
  channel to one. A channel payload carries `agentIds`.
- [x] **Off the channel:** `agent_name`, `agent_creature`,
  `agent_identity_updated_at`, `agent_brief`, `agent_brief_updated_at`,
  `agent_model`, and `agent_wake_mode` with its enum (decision 8).
  `agent_check_in_at` and `agent_profile_id` stay.
- [x] **Facts per agent:** `channel_agent_fact` is `agent_fact`, keyed by
  `agent_id`. The cap (100 facts, 4,000 characters) is per agent. Step 1
  also scoped a fact to the private channel it was learned in
  (`scope_channel_id`) and kept private channels out of other channels'
  prompts; step 2 took both out (decision 22).
- [x] **Instructions per channel:** the agent's brief is public, so what a
  team wants from it in one channel goes on its `channel_agent` row.
- [x] **Run settings per agent** (`agent_harness_settings`, decision 16):
  what it runs on and which accounts pay. `workspace_harness_settings` and
  its settings section are gone. The agent's `model` is the one model
  setting, and can be one the workspace's own API key pays for.
- [x] **Payer order** (decision 7): a person with no plan of their own falls
  to the agent's settings (`hasOwnRequestRoute` in
  `packages/db/src/queries/personal-accounts.ts`).
- [x] **The data move** (`packages/db/src/scripts/agents-from-channels.ts`):
  `scripts/push.mjs` runs it before every `db:push`, because that push drops
  what it copies. It works from the original per-channel columns or from the
  first cut (`channel.agent_id`), once per database, in one transaction:
  - each text channel's agent keeps the name and face people see;
  - facts follow their agent;
  - a brief written for an agent that only lives in private channels moves to
    those channels' instructions;
  - each agent takes its workspace's run settings, and the workspace's API
    model where it had none of its own.
- [x] **Turns:** the worker loads the agent through `channel_agent`
  (`loadAgentChannel` in `apps/worker/src/lib/agent-inbox.ts`). The prompt
  names the agent's other channels and says each is its own conversation.
  Profile change notes reach every channel of an agent.
- [x] **No agent in a channel:** nothing is queued (`addInboxMessage` and
  `addInboxNote` refuse), no check-in Loop is made, a Loop fire or an event
  there is skipped, and nothing answers a mention.
- [x] **Mentions only:** the "every message" wake mode is gone from realtime,
  Discord inbound, the worker and the payer rule.
- [x] **A different agent in a channel** starts a fresh conversation there
  (`resetAgentConversation`) and inherits the channel's instructions. The
  channel gets its check-in when its first agent is added.
- [x] **API:** `/v1/workspaces/:slug/agents` (list, create, change, delete),
  `/agents/:id/facts`, `/channels/:id/agents` (instructions per channel), and
  `agentId` on the `ai-accounts` routes. Event `agents:updated`.
- [x] **New channels:** left unpicked, a text channel gets the workspace's
  first agent. A new workspace starts with one agent in every text channel.
  Since step 2 a private channel starts with none (decision 22).
- [x] **Web:**
  - a channel's right panel starts with its agents
    (`right-panel/channel-agents-section.tsx`, decision 19): a row per
    agent. For people who manage channels, a channel with room has an Add
    agent row, and a full one has a swap button on the agent's row. Both
    open the workspace's other agents (a name opens that agent's dialog, so
    one in no channel is still reachable) and New agent. The header, the
    left sidebar and its channel rows show no agents;
  - the agent dialog (`components/agent/agent-dialog.tsx`, opened by
    `?agent=<id>`): Profile, Memory, Channels, Loops and Runs. Loops
    (`components/agent/agent-loops.tsx`, decision 21) lists the loops of
    every channel the agent is in; one opens in its channel's right panel
    through `?loop=<id>`;
  - the channel dialog, redesigned on the same shell
    (`components/ui/pane-dialog.tsx`): Overview, Agent (who is here, and
    instructions for this channel), Tools and Webhooks.
- [x] **Mobile:** follows the same data. Which agent a channel has, and how
  an agent runs, are set on web.
- [x] **Checked** on throwaway Postgres databases:
  - the move from the original shape and from the first cut: names, faces,
    private briefs and run settings, with a second push finding
    nothing of this step to change;
  - as a second person outside a private channel: that channel's
    instructions answer 404. (The scoped-fact checks made here no longer
    apply: step 2 removed the scope.)

Deviations and gaps:

- **One model after the move.** A workspace's API model used to apply only
  to work nobody asked for. An agent with no model of its own now takes it
  for everything.
- **No subscription run was made live.** No account is linked in the test
  databases, so the plan routes are type-checked only.
- **Tools stay on the channel.** A turn uses the tool profile of the channel
  it runs in, so one agent can have different tools in two channels. §5
  moves them to the agent; not done.
- **Events and Loops stay on the channel** they report in, and the channel's
  agent handles them. They do not move with an agent that leaves.
- **The log and the open block are per channel.** An agent in three channels
  does not see, in one, what is running in the others. Its facts are how
  anything crosses.
- **The conversation is still keyed by the channel** (`agent_step`,
  `agent_context`, `agent_inbox`, the run scope). A second agent in a channel
  needs its own, which is step 2's key change.
- **The session ceiling** is still 15 per channel.
- **Permissions:** managing agents takes `channel:update`; run settings take
  `billing:manage`. The person who made an agent can still rename it and
  change its face and role.
- **Voice channels** have no agent, so a Loop or event there runs on the
  defaults (Lor's own agent on Lor credits).

Rollout, per environment, with API, realtime, worker, web and mobile together:

1. `pnpm db:push`. It runs the data move first, then drops the old columns
   and `workspace_harness_settings` (drizzle-kit asks before dropping;
   `--force` skips the question).
2. Restart the workers, so no turn runs on old code.
3. Rebuild web, desktop and mobile: the channel payload changed shape.
4. Once every environment has pushed, take `agents-from-channels.ts` out of
   `BEFORE_PUSH` in `packages/db/scripts/push.mjs`.

### Step 2: memory (built 2026-11-24)

One memory under every conversation (decisions 22, 25 and 30). It needs no
change to how conversations are keyed, so it landed first.

- [x] **Facts are the agent's, with no scope.** `agent_fact.scope_channel_id`
  and everything that read it are gone: the per-scope prompt and cap, the
  member filter on the API, the "Only in" badge. A turn in any channel has
  all of its agent's facts, and its prompt names every channel the agent is
  in, private ones too.
- [x] **Who reads an agent's memory** (`memoryAgent` in the agents API):
  anyone who can see a channel the agent is in, or anyone when it is in
  none. So an agent kept to a private channel is read only by that
  channel's people, which is what makes "give it its own agent" work
  (decision 22). Not a promise: whoever manages channels can still add that
  agent somewhere else.
- [x] **A new private channel starts with no agent** (`placeDefaultAgent`):
  its own audience or its category's. A private project too.
- [x] **Archive** (`agent_fact.archived_at`, decision 30): the memory pass
  archives a fact to make room, where it used to drop it. An archived fact
  leaves the prompt, arrives in the agent's other channels as a change note,
  and is found by `recall`. A wrong fact is still deleted. People restore or
  delete archived facts in the Memory section.
- [x] **The journal** (`agent_journal`, `packages/lor/src/agent-memory.ts`):
  the memory pass writes one entry for a turn worth one, in the same reply
  as its fact changes, so it costs no extra call. An entry records the
  agent, the channel, the session, the run and the person the turn was for.
  - A conversation's frozen prompt has the last 7 days, up to 30 entries.
  - The top of each turn has the entries written in the agent's other
    conversations since its last turn there, up to 12, the ones about the
    person who woke the turn first (`journalNotes`). It rides the same
    cursor as the profile change notes, so the prompt cache holds.
- [x] **During a turn:** `remember` saves a fact at once (refused when the
  facts are full: making room is the memory pass's call), and `recall`
  searches the whole journal and the archived facts.
- [x] **Look back across places:** `read_agent_history` lists, searches and
  reads the agent's turns in every channel it is in, each result naming its
  channel. Steps from before the agent joined a channel were another
  agent's and are left out.
- [x] **Code sessions** in a channel with an agent
  (`apps/worker/src/lib/session-memory.ts`): the first turn's message
  carries the agent's facts and recent journal, and later turns carry what
  the agent noted elsewhere since. The session's own prompt does not change,
  so its cache holds. They get `remember` and `recall`. A turn of a session
  a person started adds a journal entry made from the request and the
  answer, with no model call; the agent's own sessions report to it, and its
  turn notes that.
- [x] **API:** facts carry `archivedAt` in place of `privateTo`; `PATCH` on
  a fact takes `archived`; `GET /agents/:id/journal` lists the latest 60
  entries. An entry's link to a channel or session is left out for a person
  who can't open it; its text is not.
- [x] **Web:** the agent dialog's Memory section lists the facts, the
  archived ones under a disclosure with restore and delete, and the journal.
  Mobile lists live facts only.
- [x] **Checked** live on a throwaway database, with the worker running:
  - asked in `#general` to remember something, the agent called `remember`
    during the turn and its memory pass wrote a journal entry;
  - told something there that is not a fact, then asked in `#eng` what was
    just said, it answered from the journal entry at the top of that turn;
  - `read_agent_history` in `#eng` quoted what it had sent in `#general`;
  - an archived fact arrived as a change note and `recall` found it;
  - a member outside a private channel gets 404 for the memory of an agent
    that is only in that channel, and 200 once it is also in a channel they
    can see;
  - a new private channel, and one in a private category, got no agent; a
    public one got the workspace's first.

Deviations and gaps:

- **Code sessions were not run.** The sandbox has no session computer, so
  the session note, the session's tools and its journal entry are
  type-checked only.
- **A session's journal entry is clipped text**, not a summary: a session
  has no memory pass.
- **The agent keeps its own counsel.** With a fact that says it is
  confidential, the agent declined to repeat it in a public channel. Nothing
  enforces that.
- **Brain pages keep their own scope** (`brain_node.scope_channel_id`). They
  are the workspace's knowledge, not an agent's memory, and were not touched.
- **People can't add a fact** in settings, only edit, restore and delete.
- **Search is a text match** (`ilike`) over the journal and archived facts.
  No ranking, no embeddings.
- **The log and the open block are still per channel**, as are the
  conversation and the inbox. Step 3.

Rollout, with the worker, API, web and mobile together:

1. `pnpm db:push`. It first runs `agent-facts-unscoped.ts`, which drops
   `agent_fact.scope_channel_id`. Without it the push adds `archived_at` and
   drops the scope column together, asks whether one was renamed into the
   other, and a yes would turn scopes into archive dates. Every fact that
   was kept to a private channel becomes its agent's like the rest.
2. Restart the workers: the agent's tools and prompt changed.
3. Once every environment has pushed, take the script out of `BEFORE_PUSH`.

### Step 3: conversations (backend built 2026-11-24)

The agent's own conversation and a conversation per request landed together
(decision 28): moving everything to one conversation first would make ten
people wait on one queue.

- [x] **`agent_conversation`** (`packages/db/src/schemas/agent-conversations.ts`):
  kind `own` (one per agent) or `request`, with the request's channel and
  the message it started from. `agent_inbox`, `agent_step`, `agent_context`
  and `agent_wake_up` are keyed by `conversation_id`, and an agent's own run
  carries it (`agent_run.conversation_id`, which is also its scope, so one
  turn at a time per conversation). `agent_run.channel_id` is the channel a
  turn is about.
- [x] **Which conversation a message goes to** (`conversationForMessage`):
  in a thread, that thread's request; a reply to, or a thread under,
  something the agent posted for a request continues it
  (`agent_request_post`, which also holds the Loop and proposal cards a
  request filed); anything else addressed to the agent starts a new request.
  What was not addressed to it waits in its own conversation.
- [x] **A request's first turn** reads the channel's latest chat, or the
  thread so far, since its conversation has seen none of it.
- [x] **The agent's own conversation** reads every channel it is in: what
  waited is listed channel by channel, and each turn names the channel it is
  about. `send_message` takes `channel` to post in another channel the agent
  is in.
- [x] **The hidden check-in** (decision 26, `sweepCheckIns` in
  `apps/worker/src/lib/agent-inbox.ts`): every minute the sweep wakes an own
  conversation that has something unread, last looked at least 15 minutes
  ago and has nothing else about to wake it. The check-in Loop, its
  per-channel marker (`channel.agent_check_in_at`) and the code that made it
  are gone.
- [x] **Loops, events and wake-ups:** a Loop's fire and a trigger's event
  wake the own conversation of their channel's agent, in a turn about that
  channel. A wake-up wakes the conversation that set it. A session's report
  goes to the conversation that started the session
  (`agent_session.conversation_id`).
- [x] **The profile, the log and the open block are the agent's.** A request
  reads its channel's instructions and the own conversation reads those of
  every channel. The log and "Open right now" span every conversation, so
  two requests see the same running sessions and pending approvals.
  `read_agent_history` reads every conversation.
- [x] **An agent taken out of a channel** reads nothing more from it: what
  waited from that channel is dropped, and a turn about it is skipped. Its
  conversations stay. Deleting an agent deletes its conversations.
- [x] **The data move** (`packages/db/src/scripts/agent-conversations.ts`,
  run before the push): each channel's conversation so far becomes a kept
  conversation of the agent now in it, to read and not to continue; what
  waited unread and pending wake-ups go to that agent's own conversation;
  check-in Loops are deleted.
- [x] **Checked** live on a throwaway database, with the worker running:
  - two requests in one channel became two conversations, and a quick one
    started and finished while a slow one was still running;
  - a reply to the agent's answer, and a thread under another answer, each
    went on in their own request;
  - two unaddressed messages in two channels were read by one check-in
    turn, which stayed quiet about one and posted in the other channel;
  - a request's next turn began with the journal entries of the other
    request and of the check-in;
  - the move kept 4 channel conversations and deleted 4 check-in Loops, and
    a second push changed nothing.
- [ ] **Chats in the app:** the sidebar's chat list is built (see "The chat
  list" below). Not built: New chat, the chat's header and panel, finding
  and joining a chat, and a view of what the agent did on its own.
- [ ] **Loops on the agent** (decision 27): a Loop is still stored on its
  channel, which is where it posts by default. It follows the channel's
  agent, not the agent. Events too.

Deviations and gaps:

- **A request starts cold.** It has the agent's facts, journal and the
  channel's latest chat, not the agent's earlier turns in that channel. The
  kept channel conversations are read with `read_agent_history`.
- **Two mentions in a row are two requests.** Only a reply or a thread
  continues one, so "@Inky fix X" then "@Inky also Y" run side by side.
- **A turn of the own conversation is about one channel:** the one of what
  woke it. Posting elsewhere takes `send_message`'s `channel`.
- **"Working" is per channel.** With two turns about one channel, the first
  to end clears it until the other's next beat, up to 10 seconds.
- **Not run:** Discord inbound, triggers, wake-ups, approvals pausing a
  turn, sessions reporting back, and compaction are type-checked only.
- **The push asks an unrelated question** on a database with brain pages
  (`brain_node_parent_scope_name_uq`, truncate or not). It did before this
  step. The answer is no.

Rollout, with API, realtime and worker together:

1. Stop the workers. Queued agent jobs name a channel and are dropped, and a
   turn running during the move would write to columns that are going away.
2. `pnpm db:push`. It runs `agent-conversations.ts` first.
3. Start the workers. Once every environment has pushed, take the script
   out of `BEFORE_PUSH`.

Prompt cache (2026-11-25, `packages/lor/src/agent-loop.ts`). Markers only:
the prompt's text and order are unchanged.

- **A shared cache point.** The tools and the prompt down to the agent's own
  section (`AGENT_SECTION_HEADING`) are the same for every conversation in a
  workspace, about nine tenths of a new conversation's prompt. They are sent
  as their own block with a one-hour cache point (`cachedInstructions`), so
  a new request, or another agent's check-in, reads them instead of writing
  them again. Measured: the first call of a new request read 20,268 of
  25,034 tokens, where it read 0 of 23,260 before. A check-in 16 minutes
  after anything else ran still read it.
- **The agent's own conversation is kept an hour** (`keepsCacheAnHour`): its
  check-ins are 15 minutes apart, so on the five-minute cache every one paid
  to write its whole history and read none of it. A request stays on five
  minutes, where a write costs less (1.25 times the input price, against 2
  times for an hour).
- **The gateway's automatic cache points are five minutes and override a
  longer one on the same message** (a check-in 16 minutes after the last
  read only the shared top). A conversation kept an hour therefore marks its
  own (`withLongCache`) and turns the gateway's off (`gatewayOptions`).
  Measured after that: a check-in 9 minutes after the last read 24,937 of
  25,219 tokens. The one-hour marker used above 100,000 tokens had the same
  fault and had never been measured.

Several agents in a chat (decision 32, built 2026-11-25), each posting as a
bot user of its own (decision 37, built 2026-11-25):

- **An agent is a user.** `agent.id` is also the id of a bot user
  (`user.is_bot`, foreign key from `agent.id`), made with the agent by
  `createAgent`. It has no account row, an address that can't receive mail
  (`<id>@agent.lor.invalid`) and no workspace membership, so it never signs
  in, counts as a seat, shows in the member list or gets a notification.
  Renaming the agent renames it. Deleting the agent leaves it, so its
  messages keep their author.
- **Who wrote a message** is its author: the worker posts everything an
  agent's turn says as that agent's user (`postLorMessage`). Message
  payloads still carry `agentId`, now read from the author
  (`agentAuthorId`), so clients tell an agent's message from a person's
  without a list of agents. Lor's own user still writes sessions, cards and
  events; one of its messages in a chat shows as the chat's first agent's.
  Typing still comes as Lor's with the agent's id beside it.
- **Mentions.** Each agent is mentioned by its own id, `<@agentId>`, which is
  what the composer inserts. Lor's own mention means the chat's first agent,
  as every chat with one agent used it (the mobile app and Discord still
  send it).
- **Routing** (`addChatMessageToAgentInbox`, `agentsNamed`). The agents a
  message names (by mention, or by replying to what one wrote) are woken, each
  in its own request conversation. Every other agent in the chat gets the
  message in its wait lane, for its check-in; with nobody named, all of them
  do. In a human thread it reaches the agents it names, or with none named
  every agent already in the thread, and nobody else.
- **What an agent is told.** Its own mention, the other agents it shares a
  chat with (name, role, mention, which chats), that a message naming one of
  them is theirs, and that one naming nobody is to be answered only when it
  is clearly its own. Another agent's messages go by that agent's name in
  what it reads (inbox, replies, `read_thread`).
- **The cap** is `MAX_CHANNEL_AGENTS` (8). The right panel adds and removes
  agents; the channel and agent dialogs handle several.
- **Woken without a mention** (decision 38, LOR-171, built 2026-11-25). A
  top-level chat message that names no agent still waits in every agent's
  inbox, and realtime queues a `classify` job for it (Discord's inbound
  does the same). The worker (`classifyInboxMessage`) asks Jev one yes/no
  question per agent (`packages/lor/src/inbox-address.ts`), given the chat's
  last 12 messages, each agent's role, brief and open sessions in the chat,
  and who wrote the message. An agent at or above `INBOX_ADDRESSED_MIN`
  (0.5) is woken in a request of its own (`wakeForWaitingMessage`,
  `agent_inbox.inferred`); the rest keep it for the check-in. The woken
  agent reads "not addressed to you by name" on the message and may end the
  turn quiet. Such a turn shows no typing, posts no out-of-credits notice,
  and never runs on the writer's own plan. A failed or slow call (5 s)
  leaves the message waiting, as before. Not classified: thread replies,
  and messages that name any agent. Sampled live with an Eng and a Support
  agent: asks in one agent's area scored 0.73 to 0.86 for it and at most
  0.29 for the other; a follow-up to the agent's answer 0.85; talk between
  people, an fyi, "ok thanks" and a question for a named person at most
  0.11; "does anyone know when the next release goes out?" 0.21. About
  1,000 tokens, $0.00004 and under half a second a message, recorded as an
  unbilled usage row (`lor.inbox.classify`).
- **Left out on purpose:** one agent mentioning another does not wake it
  (they could answer each other without end), and each agent is told so.
  Discord stays the first agent's.
- **What changed for people with bot users:** an agent's post now counts
  toward a chat's unread badge after a reload (`countsAsUnread` skipped
  Lor's messages, though the live notification always counted them), and a
  notification preview names a mentioned agent.
- **Checked live** with two agents in one chat. Before bot users: a mention
  of one woke only that one and waited for the other; a message naming
  nobody waited for both; one naming both got an answer from each, under its
  own name and face. With bot users: the push script on a database with
  agents and their messages, a mention, a reply to an agent's message with
  no mention (it woke nobody until `loadReferencedMessage` passed the agent
  on), and a new agent getting its user. Not run: threads, typing with two
  agents at once, renaming, Discord, mobile (type-checked only).
- **Rollout:** `pnpm db:push` with the workers stopped (it also adds
  `agent_inbox.inferred`). It first runs
  `agent-bot-users.ts`: a user for every agent, and each chat's earlier
  agent posts (written as Lor) handed to the chat's first agent. Then it
  adds `channel.kind` and the foreign key. Deploy API, realtime, worker and
  web together: the old code posts as Lor and writes a column that is gone.

The chat list (decisions 33, 35 and 36; sidebar built 2026-11-25):

- **Who is in a chat** is `channel_member` on the chat itself, the table
  that already lists the people of DMs and private channels (Jacob,
  2026-11-25; a table of its own, `chat_member`, was built first and
  replaced the same day). Each row carries that person's own `pinned_at`
  and `hidden_at`. Whether the list also decides who can see the chat is
  the audience, as before: for a private chat or project it is the rows on
  the access container. A chat inside a project has its own rows for who is
  in that chat, and leaving the project leaves its chats. A hidden chat is
  left out until a message newer than the hide, so nothing is written when
  one arrives.
- **Who is put in a chat** (`packages/db/src/queries/chat-members.ts`).
  Until New chat picks its people: a chat made by the old create dialog, a
  proposal, a project or the workspace template starts with everyone who
  can see it; a new workspace member, and someone added to a private
  project, is put in every chat they can now see. Bots are never members.
- **The API** (`apps/api/src/routes/v1/chats`): `GET /chats` lists the
  caller's chats with the last message the chat feed shows (not event
  lines), a plain-text preview, the agents and the first four people; `PATCH
  /chats/:channelId` pins or hides for the caller.
- **The sidebar** (`apps/web/src/components/sidebar/chat-panel`): Pinned in
  the order they were pinned, then Recent by last message. A row is the
  chat's faces (agents, then people), its name, when it was last active and
  one line of the last message, with the unread dot or mention count, a pin
  on hover and its code sessions under it, as they sat under a channel. A
  right click pins, hides, mutes, edits or deletes. Other people's messages
  move a chat up from the unread notification; the person's own send
  refetches. The default width went from 240 to 296.
- **Notifications** follow the people in a chat since 2026-11-26 (see
  "Listeners and notifications" below). The mobile app still lists channels.
  Categories, projects and voice channels are no longer in the web sidebar
  (voice is behind its launch flag); `channel-list.tsx` is unused and goes
  when New chat replaces the create dialog it still shares code with.
- **Checked live** on a throwaway database with five people and three
  agents: the fill of existing chats (a private chat only its two members,
  a second run a no-op, a chat the person left not refilled), a database
  with `chat_member` rows carried over with their pins and hides, a person
  outside a private chat neither listing nor pinning it, the list order, pin and unpin,
  hide from the menu and the chat coming back on a new message, an agent's
  reply moving its chat to the top with an unread dot, sessions under their
  chats, a chat made through the API appearing live with its people, and a
  new member being put in the open chats and not the private one. Not run:
  invitations and project member adds through the app, mobile.
- **Rollout:** `pnpm db:push`. Before the push, `chat-member-table.ts`
  moves the rows of a database that has `chat_member` onto `channel_member`
  and drops the table. After it, `chat-members.ts` puts everyone who can see
  it in each text channel nobody is in; chats with people are left alone,
  so nobody is put back in one they left.

New chat (decisions 31 and 35, built 2026-11-26):

- **A start screen in place of a chat** (`/{workspace}/new`,
  `apps/web/src/components/chat/new-chat-view.tsx`), reached from the plus
  beside the sidebar's search, which used to open the New Channel and New
  Category menu. It is the mock's: the chat's face fills in as agents and
  people are picked, a name that may be left empty, and a first message.
- **It starts with the people picked and its maker**, not everyone: the
  create route (`POST …/channels`) takes `memberIds` for an open chat and
  skips the fill that puts everyone in. The chat stays open, so anyone
  else can find and join it once that is built. Left unnamed, the route
  names it by who is in it (agents, then first names).
- **The first message** is sent after the chat is made, through the same
  socket send as the composer. A send that fails leaves the chat and says
  so.
- **Agents:** picking them takes channel:update, as before. Without it the
  picker is not shown and the chat gets the workspace's first agent.
- **Not built:** a private chat can no longer be made from the web app: the
  old dialog that had the switch is unreachable, and New chat makes open
  chats only (decision 35; Jacob, 11-26: no private switch for now).
  Existing private chats are untouched.
- **Checked live:** a chat with two agents and a first message (named after
  them, the message sent, both in the list at once, an agent answered); a
  named chat with one agent and two people (only those two and the maker
  are members).

The chat's header and panel (built 2026-11-26):

- **The header** (`apps/web/src/components/chat/header.tsx`) shows the
  chat's face and name in place of the "#", with a lock on a private one.
  Pressing it opens the details panel beside the chat, or puts it away.
- **The details panel**
  (`apps/web/src/components/sidebar/right-panel/chat-details-panel.tsx`)
  replaces the workspace's member list beside a chat: the chat's face and
  name (a field for whoever may rename it), its agents (the section that
  was there), then the people in it, and the loops and follow-ups that
  were there. Voice channels keep the old list. Roles and removing someone
  from the workspace stay in workspace settings.
- **People** are the chat's own (`GET …/chats/{id}/people`). Anyone who can
  see an open chat adds people to it (`POST`, an "added" line in the
  chat); anyone leaves (`DELETE …/people/{me}`, a "left" line, and they
  land on the top chat they are still in); removing someone else takes
  channel:update. Someone looking at a chat they are not in gets Join
  chat, which says nothing in the chat. A private chat's list is also who
  can see it, so adding there takes channel:update; a chat inside a private
  project takes only people already in the project. The person added or
  removed gets `channel:created`, which their chat list refetches on.
- **Wording:** the lines in a chat say "created this chat", "renamed the
  chat from A to B" and "left the chat", in the app and in what agents
  read (`packages/messaging/src/channel-events.ts`); the composer says
  "Message {name}".
- **Checked live:** the header toggling the panel; a person added, another
  removed and the chat renamed from the panel, each with its line in the
  chat and the list and header following; leaving (out of the list, landed
  on the top pinned chat), opening the chat again as someone not in it, and
  Join chat. Not run: a private chat, a chat inside a project, someone
  without channel:update, a second person's screen following live.

Listeners and notifications (decisions 40 to 42, built 2026-11-26):

- **A listener is today's trigger with an owner.** `connector_trigger` gains
  `agent_id` (who hears the event; null means the chat's first agent, as
  before), `filter` and `notify`. `channel_id` stays and now means the chat
  the agent reports in, which the agent has to be in.
- **Several agents per event** (decision 42). The table is unique per
  connection, event and agent, so an event has a list of listeners, each
  with its own chat, filter, instructions and limits. A row with no agent
  is distinct to Postgres; the API keeps an agent to one listener per event,
  counting an earlier row with no agent as its chat's first agent.
- **Delivery** (`dispatchConnectorEvent`) goes to every listener of the
  event. Each filter is asked on its own
  (`packages/lor/src/listener-filter.ts`, Jev, fails open): an event it
  turns away is logged as "filtered" for that listener only. Listeners that
  post into the same chat share one message, quiet unless one of them has
  `notify` on. Then the event goes into each listening agent's own
  conversation, waking it when the listener has instructions.
  `trigger_delivery.outcome` records what became of each.
- **The API** (`apps/api/src/routes/v1/integrations`): an integration's
  `events[].listeners[]`, `POST …/listeners` (a new one wakes its agent and
  posts nothing), `PATCH` and `DELETE …/listeners/{id}` (a patch changes
  only the fields sent), `GET …/listeners/{id}/activity` and
  `GET …/suggestions`. A change proposal's `set_trigger` sets the event's
  first listener.
- **On the connector's page**
  (`apps/web/src/components/workspace/connector-events.tsx`) events are one
  list, a line each: the faces and names of the agents that hear it, or
  for an event nobody listens to, one press to add the agent a model
  suggests (`listener-suggest.ts`, the small model in one call; Jev was
  tried and suggested almost nobody) and a menu for anyone else. "Add all
  suggested" takes every suggestion at once. One event opens at a time:
  its listeners as chips, a plus to add another agent, and the picked
  listener's form. Changes save as they are made and show at once.
- **The form** (`trigger-effects.tsx`, shared with a chat's Webhooks tab)
  is one flat list: the chat it reports in, "Only when" (the filter), "Wake
  {agent}" with instructions, "Post it in {chat}" with "Notify people".
  There is no code target (agents start code sessions themselves) and no
  wake limit: the hourly and daily caps are removed, columns and all
  (decision 43). Hovering a listener's chip
  puts an X over its face that removes it, with Undo in the toast; a clock
  at the end of the chips opens the last 30 deliveries.
- **On the agent's page** the sidebar is two groups (Jacob, 11-26): what
  the agent is (Profile, Memory, Model) and, under "Wakes {agent}", the
  four things that wake it: Chats (a mention), Loops (a schedule), Events
  (its connector listeners, each opening its connector) and Webhooks (the
  custom webhooks it hears, with New webhook). "Channels" became Chats and
  "Runs" became Model; the tab ids in `?agentTab=` changed with them.
- **A custom webhook is a listener too** (built 2026-11-26). It is one
  `webhook` connection with its trigger, which carries the agent that hears
  it and the chat that agent reports in. Made from the agent's page
  (`POST …/channels/{chat}/webhooks` with `agentId`) it starts in the
  agent's first chat, wakes the agent and posts nothing; made from a chat's
  Webhooks tab it posts and is heard by the chat's first agent, as before.
  `GET …/agents/{id}/webhooks` lists the ones an agent hears, including
  those that name nobody in a chat where it is first. `PATCH` takes
  `channelId` (move it to another chat the agent is in; a saved repository
  the new chat can't use is dropped) and `agentId` (which of the chat's
  agents hears it). One list and editor serve both places
  (`channel-webhooks-tab.tsx`): "Reports in" on the agent's page, "Heard
  by" in a chat with several agents. A webhook has one listener.
- **Notifications** (`buildMessageFanout`, `read-states.ts`). A chat's own
  message reaches the people in it (`channel_member`), not everyone who can
  see it; a chat nobody is in yet still reaches everyone. A direct mention
  reaches anyone who can see the chat and puts them in it, and so does
  writing in it. A thread's reply is unread only for its followers, live
  and on reload. A chat linked to Discord sets `notify` off on every
  payload, so no browser or push notification is sent; a direct mention
  still pushes.
- **Checked live:** an event the filter should turn away scored 0.01 and was
  logged as filtered; one that passed was posted quietly and woke the
  listening agent, which answered in six seconds; one event with two
  listeners in two chats was turned away by one's filter and still reached
  the other, and a second event reached both, each agent answering in its
  own chat; suggestions for a CRM connector picked the go-to-market agent
  and for GitHub the engineering one; a suggestion turned on in one press
  and five at once with "Add all suggested"; a second agent added to an
  event from the page; a mention put a person in a chat, and so did writing
  in one; a webhook made from an agent's page, moved to another chat from
  there, woke the agent on an event with nothing posted and was answered in
  the chat it was moved to; the same webhook showed in that chat's Webhooks
  tab, where its agent was switched and switched back; five events in two
  seconds all woke the agent after the caps were removed. Not run: a real
  connector's webhook, the notify switch's effect on a push, threads, a
  Discord-linked chat.
- **Not built:** listeners an agent proposes for itself beyond the existing
  change proposal. A custom webhook keeps one agent on purpose (Jacob,
  11-26): to reach another agent, make that agent a webhook of its own.
- **Rollout:** `pnpm db:push` adds the columns, swaps the unique index and
  drops `hourly_run_cap` and `daily_run_cap`.
  Existing triggers keep their chat and are heard by its first agent; their
  posts stop pinging until "Notify people" is turned on.

### Step 4: places and tools

- A Slack or Discord channel as a place on the agent, not a Lor channel
  (decision 24). Discord first: a thread as a chat, and DMs to the agent.
- Tools on the agent (decision 29).

### Step 5: Slack

In the same shape.

## 10. The mock

`/prototype/agents` (dev only, made-up data,
`apps/web/src/components/prototype/agents/`) shows this shape: the sidebar,
a channel with and without an agent, a channel that lives in Slack, a mention
becoming a chat, a chat with its sessions, New chat, and the agent's settings.
Its sidebar still lists agents with their chats under them, which decision 19
replaced.
`/prototype/orchestration` still shows the earlier thread-based shape.

`/prototype/chats` (dev only, made-up data,
`apps/web/src/components/prototype/chats/`) shows decisions 31 to 33: Lor as named group chats, each with people and
any number of agents, and nothing else to start with (no statuses, kinds of
chat or projects). The sidebar lists chats in Lor's own sidebar language: pinned
ones first, which keep their place, then recent ones, where a chat with a
new message moves to the top. A row has the chat's face (its agents and
people in one circle), its name, who spoke last and what they said, or which
agent is working there now. A chat's header opens the right panel: its name,
agents, people and sessions, and an agent's row opens that agent. The
composer has a chip per agent that puts its name on a message; the agents
named answer, and alone with one agent it reads every message. New chat is
a start screen: pick agents and people, name it or leave it to be called by
who is in it. A chat's code sessions are listed under its row in the
sidebar, with the rows the sidebar has today under a channel (icon, title,
line counts, state, archive on hover; the newest three, the rest behind "N
more"). A thread with an agent in Slack or Discord shows as a chat with its
sessions and approvals.
