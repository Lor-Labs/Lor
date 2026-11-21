# Always-on agents: one agent and one chat per channel

**Status:** Plan for LOR-169, decided with Jacob between 2026-11-16 and
2026-11-19. Building started 2026-11-18: slice 1 is partly built, with
`db:push` and a live run owed (§13). There is no launch flag: the work ships
in one batch when it is all done (Jacob, 11-19). It replaces the proposal in `planned/team-agents.md`, which stays
as the record of how the design was reached. Where the two differ, this doc
wins.

The mocks at `/prototype/agents` and `/prototype/orchestration` show an
earlier shape, with threads and a page per agent. §9 says which parts of them
still apply.

## 1. The product

Every assistant a team can use today is personal. **Lor is always-on agents
for your team, with the team's context and memory in one place.**

- **A channel is one agent and one chat.** People and the agent talk in it.
- **The agent is a teammate for one area,** such as #eng, #gtm or #support.
  It is wired to that area's tools, events and timers.
- **It reasons over what arrives and has one way to speak:** a tool that
  sends a message to the channel's chat.
- **It does heavy work by starting code sessions,** which it uses like a
  tool.
- **Not only code.** The same loop serves every area. Code is how an agent
  gets work done, not the market Lor is in.

The whole mechanism:

```
 chat messages, webhooks, connector events, Loops,
 finished sessions, wake-ups
                  |
                  v
             [ inbox ]        one per channel
                  |
        wakes it now, or waits unread
                  |
                  v
             [ a turn ]       the channel's agent, with memory and tools
                  |
    +-------------+--------------+----------------+
    |             |              |                |
  stays quiet  send_message  start a session     wake_up
```

This unites what Lor already has. Loops, webhooks, connector triggers and
`@Lor` stop being separate ways to start a session and become things that
arrive in one inbox.

## 2. Decisions

"Jacob" means he decided or agreed it in the session. "Default" is my
proposal that he has not objected to and should confirm.

| # | Decision | Status |
|---|---|---|
| 1 | A channel is one agent and one chat. No chat per person, no threads of our own | Jacob, 11-18 |
| 2 | One conversation, one queue, one turn at a time. A blocked chat is accepted | Jacob, 11-18 |
| 3 | Not only code: every channel's agent is general for its area | Jacob, 11-17 |
| 4 | The main chat replaces chat sessions. New session is code only. Existing chat sessions stay readable | Jacob, 11-18 |
| 5 | Everything goes into the channel's inbox. Nothing calls the agent directly | Jacob, 11-18 |
| 6 | Two lanes: some things wake the agent now, the rest wait unread until its next wake | Jacob, 11-18 |
| 7 | A check-in bounds the wait. It is a Loop that comes with every channel: every 30 minutes, all day (Jacob, 11-20; it was active hours only), skipped when nothing is unread. It is not `wake_up`, which the agent sets itself | Jacob, 11-18 |
| 8 | Per channel: wake on mentions (the default) or on every message | Jacob, 11-18 |
| 9 | One tool to speak, `send_message`. A turn can end quietly | Jacob, 11-18 |
| 10 | `wake_up`: the agent schedules its own wake, with instructions for its future self | Jacob, 11-18 |
| 11 | A memory pass after each turn, as in Lee Robinson's talk: one call on the turn's warm cache updates the channel's facts and, when something clears the bar, brain pages. No `remember` tool. Fact changes are not posted in the chat. For the agent it replaces today's write-back pass; sessions keep theirs | Jacob, 11-19 |
| 12 | Sessions are tools to the agent: start, check, message, stop. A finished session is an inbox event | Jacob, 11-18 |
| 13 | A session the agent starts gets code tools and read access only. A session a person starts keeps what it has today | Jacob, 11-18 |
| 14 | The agent's own turn starts no sandbox unless a tool needs one | Jacob, 11-18 |
| 15 | One model per channel, chosen in setup, default Opus 5.5, used for every turn including wakes | Jacob, 11-18 |
| 16 | The agent runs on the API. A code session uses a person's Claude or ChatGPT plan only when a known person asked and has connected one | Jacob, 11-18 |
| 17 | A channel profile is always in the prompt. The agent may change its facts on its own; only people change the brief | Jacob, 11-18 |
| 18 | The log is built from records, and what is open is computed at each wake | Jacob, 11-18 |
| 19 | Profile and log are per channel. Brain pages stay shared across the workspace | Jacob, 11-18 |
| 20 | Context rules: a fixed top, a fixed tool list, compact while the cache is warm (28), bulk stays out, a cache miss is a bug | Jacob, 11-18 |
| 21 | Discord is the first chat app after Lor | Jacob, 11-18 |
| 22 | A channel's chat lives in one place, Lor or Discord. When Discord is linked, Lor shows it read-only | Jacob, 11-18 |
| 23 | Approvals work as they do today: an action needs approval only where an approval rule or a session's safety check says so. Who is asked: the person or role the rule names, else the session's subscribers, else whoever gave the instructions (§5) | Jacob, 11-18 |
| 24 | The sidebar has two tabs: what needs you with running sessions, and channels | Jacob, 11-18 |
| 26 | No product limit on how many sessions a channel runs. A safety ceiling of 15 at once | Jacob, 11-18 |
| 25 | Later: a persistent computer and its own repo per agent, agents talking to each other, custom apps | Jacob, 11-17 |
| 27 | The agent's turn runs on a loop Lor owns: Lor stores every step and assembles the prompt by hand. It does not run on a session's engine. Sessions keep their harnesses | Jacob, 11-18 |
| 28 | Compaction as in Lee Robinson's talk: the history grows until it passes about 100k tokens, then is summarized about 10 minutes after a turn, on the warm cache, unless other work is about to wake the agent. The latest messages stay word for word. Every step stays stored, and the agent can read its history, a thread or a session back in full | Jacob, 11-18 |
| 29 | The agent's computer is its own: for installing things and using websites, not for writing code. Planned, not built now. A tool starts it, a turn never does | Jacob, 11-18 |
| 30 | The chat never shows what woke the agent. A Loop's or a `wake_up`'s turn reads as the agent noticing something itself: no "ran on schedule" line, no line when the agent completes a Loop (the card shows it), no failure notice on a turn no person asked for, and the agent doesn't narrate the Loop. `wake_up` and Loops stay separate | Jacob, 11-20 |
| 31 | Loops and triggers have no model of their own: the channel's agent receives them and runs on the channel's model (decision 15). The per-Loop and per-trigger model pickers on `dev` (785d3ec) go when it is merged in | Jacob, 11-20 |
| 32 | Each channel names its agent, and the name replaces "Lor" wherever that agent appears: its posts, mentions, the working indicator, Needs you, settings. Names are the team's to choose, not the channel's name | Jacob, 11-21 |
| 33 | Each channel's agent has a creature from a bestiary of 8 to 10 high-quality pixel-art creatures, animated by its real state (asleep, working, needs you) | Jacob, 11-21 |
| 34 | Code sessions run on Claude Code or Codex only; Lor's own agent (Pi) is no longer a session harness. Sessions are the channel agent's tools, or ones a person starts | Jacob, 11-21 |
| 35 | Discord ships in this batch (slice 6), with the chat-location choice in the channel's Agent settings | Jacob, 11-21 |

Considered and dropped, so they are not added back by accident:

- A thread object of our own, a chat per person, and a background context
  per subject. All three made the product too complex.
- Trust levels per watch, levels for how the agent behaves in a room, and
  coded rules for when it may reach out. The model decides, guided by the
  brief.
- A separate cheap model for wakes.
- Slack first. Jacob's team talks in Discord.

## 3. The inbox

A table of events per channel. Sources write to it; one worker per channel
reads it.

| What arrives | Lane |
|---|---|
| A message that mentions the agent, or replies to one of its messages | Wakes it now |
| A session it started finishes, fails or asks a question | Wakes it now |
| A `wake_up` comes due | Wakes it now |
| An approval is answered | Wakes it now |
| A webhook, connector event or Loop set to wake | Wakes it now |
| Any other chat message | Waits unread |
| A webhook or connector event set to wait | Waits unread |
| The check-in Loop, when something is unread | Wakes it now |

- **Unread items are read at the next wake,** ahead of the thing that woke
  it. The agent sees them under "Since you last looked", then "What woke
  you".
- **Batching:** when a waking item arrives, the worker waits a few seconds
  of quiet, takes everything pending and runs one turn. Three quick messages
  get one reply.
- **One turn at a time.** A mention that arrives mid-turn steers the running
  turn, which Lor's agent already supports. Everything else waits for the
  next turn.
- **Duplicates are dropped** on the source's own id.
- **A turn can run more than once** after a crash, so tools that act must
  tolerate a repeat. An approval runs the arguments that were stored with
  it.
- **Timers are not inbox rows.** Wake-ups and Loops live in their own
  tables, and a scheduler adds an inbox event when one is due.

Each row holds: source, the source's id, channel, lane, a pointer to the
message, trigger delivery or session it is about, status (pending or read),
and when it arrived.

How today's pieces map:

| Today | Becomes |
|---|---|
| A trigger with only the post effect | A card in the chat, in the wait lane |
| A trigger with the act effect | An inbox event in the wake lane, carrying the trigger's instructions |
| A trigger's session mode (per event, per subject, ongoing) | Gone. There is one conversation |
| A Loop | An inbox event in the wake lane, carrying the Loop's instructions. Its own recurring session goes away |
| `@Lor` in channel chat starting a session | A wake. The agent answers in the chat |
| "People go first" for trigger events | Kept: it is the one-turn-at-a-time rule |

## 4. A turn

Lor assembles the prompt itself, from steps it stores (decision 27), in
the order Lee Robinson's talk describes for Grok Bot. The agent's turn does
not run on a session's engine.

Stays the same until the next compaction:

1. Tool definitions: the same set on every call. Other tools are listed by
   name, and their schemas load on demand.
2. The system prompt: Lor's rules, workspace instructions, the channel
   profile (brief and facts) and the recent log, as a snapshot taken when
   the conversation started or was last compacted.
3. The first message: the environment and the tool names. After a
   compaction, also the summary and the latest messages word for word (§8).

Grows only at the end:

4. Every turn since, in full: the inbox text, the agent's tool calls and
   results, and what it sent.

New on every call:

5. The newest message: the time, change notes (a fact changed, a tool was
   added), what is open, the unread items and what woke it.

Nothing above the newest message is ever edited. A change to the profile,
the log or the tools reaches the agent as a change note, and the snapshot
catches up at the next compaction.

A turn ends one of three ways: quietly, with a `send_message`, or waiting on
an approval.

## 5. The agent's tools

| Tool | What it does |
|---|---|
| `send_message` | Posts to the channel's chat, in Lor or the linked Discord channel. Text, files, or a control that asks for a decision. The only output people see |
| `wake_up` | Schedules a wake at a time, with a note to its future self |
| `start_session`, `check_session`, `message_session`, `stop_session` | Runs code sessions as helpers |
| Connector tools | Read and write, as the channel's tool profile allows. Writes follow the approval rules |
| Memory tools | Read, search and write brain pages, as today. Facts change only in the memory pass (§7) |
| Its computer | A sandbox that starts only when a tool needs it |

- There is one place to send, so the model never chooses where.
- **Two timers, two jobs.** `wake_up` is set by the agent for one moment,
  with a note: "at 15:00, check the deploy". The check-in is a Loop every
  channel starts with. It exists so unread items never wait forever, and a
  person can change its cadence or turn it off like any Loop.
- **Approvals work as they do today.** An action pauses only where an
  approval rule covers that tool, or a session's safety check flags a
  command. Who is asked, in order:
  1. The person or role the approval rule names.
  2. For something flagged inside a session, the people subscribed to that
     session.
  3. Otherwise whoever gave the instructions: the person who asked, or who
     set up the trigger or Loop.

  Step 3 needs triggers to record who set them up. Loops already do.
- **What this leaves open:** on a turn no person started, a write with no
  approval rule runs unasked, as it does for trigger runs today. The text
  such a turn reads came from outside (an alert body, an issue someone
  filed), so a workspace should put approval rules on the writes it cares
  about.

## 6. Sessions

A session is one coding agent on one branch of one repo, with a dev box. It
stays as built.

| | A session the agent starts | A session a person starts |
|---|---|---|
| How | `start_session` from a turn | New session, as today |
| Tools | Code tools, read-only connectors, memory search | Unchanged |
| Writes to connectors, sending messages | No. It reports to the agent, which acts | Unchanged, with approvals |
| Coding agent | The asker's Claude or ChatGPT plan when a known person asked and has connected one. Otherwise Lor's own, on the API | Unchanged |
| When it ends | A short report arrives in the inbox and wakes the agent | Unchanged |

- **Why reads stay:** a coding agent has to look things up mid-task, such as
  the issue's comments, a stack trace, or logs that show the fix worked.
- **Why writes move up:** a session the agent started has nobody watching,
  and it reads untrusted text on a third-party coding agent.
- **One voice:** several sessions report to the agent and it writes once.
- **A piece of work that spans repos** is several sessions. A session stays
  one repo.
- People can open, watch and take over any session, as today.
- Lor still never commits or opens pull requests. People do.

There is no product limit on how many sessions a channel runs. A safety
ceiling of 15 at once stops a runaway.

## 7. Memory

| Piece | Today | Change |
|---|---|---|
| Always in the prompt | Workspace instructions | Add a channel profile: the brief and up to about 100 facts, capped near 4,000 characters |
| What happened recently | Only the chat itself | A log built from records: sessions started and finished, messages sent, approvals, wake-ups, events |
| What is open right now | A plan per session | A block computed at each wake: running sessions, approvals waiting, wake-ups pending |
| Everything else | Brain pages and search | Unchanged. The full chat and every step stay stored, so compaction loses nothing for good |

- **The brief gives instructions and only people change it.** Facts are
  information. The memory pass changes them (below). Changes are not posted
  in the chat: the facts are listed in the channel's settings, each with its
  source and date, and anyone can edit or delete one.
- **The log and the open block come from data,** not from the model, so they
  cannot drift.
- **Compaction** replaces the history with a summary while the cache is
  warm (§8). Nothing is deleted, and the agent can read anything from
  before it back in full.
- **The profile and log are a snapshot** in the system prompt, refreshed at
  each compaction. Changes in between arrive as change notes.
- **Scope:** the profile and log belong to the channel. Brain pages are
  shared across the workspace, with private channels scoped as today.
- **Stored memory informs. It never instructs.** A note inferred from a
  webhook or an issue body does not carry the weight of something a person
  said.

**The memory pass** (Jacob, 11-19: as in Lee Robinson's talk)

| | Rule |
|---|---|
| When | Right after every turn, quiet or not. It does not hold up the next turn |
| How | One call on the turn's prompt while the cache is warm (same tools, system prompt and model), with the current facts and the request added at the end |
| Facts | It adds, rewrites or removes facts, and can rewrite or remove only facts it was shown, by id. At most 100 in about 4,000 characters: when full, it replaces or drops one to add one. It never touches the brief. Anything a person asked it to remember is saved |
| Sources | Each fact keeps who said it, or which webhook or issue it came from |
| Brain pages | When something clears today's bar (a settled decision, how a system works, who owns something, a resolved problem, a lasting convention), it edits brain pages with the memory tools the agent already has. Lor refuses any other tool during the pass |
| Result | Most turns change nothing. The agent learns of a change from a change note in its next turn, and the snapshot catches up at compaction |
| Cost | One more call per turn on the warm cache: a few cents at a 100,000-token chat on Opus 5.5, mostly its own output. If that adds up, today's cheap first check goes back in front of it |

For the agent it replaces today's write-back pass, a separate call that
reads the turn again without the cache. Sessions keep that pass.

Reused as built: brain pages and their channel scope, search over messages,
sources and attachments, and the divider Lor already shows where context was
compacted.

## 8. Context and caching

An always-on agent often wakes after its cache has expired. On Opus 5.5 at
Anthropic's list prices, input is $4 per million tokens and a cached read is
$0.20. A 150,000-token chat costs about $0.60 to read cold and $0.03 cached.
The cache lasts 5 minutes, or an hour at double the write price, and each
read renews it.

1. **A fixed top that is never edited** (§4, items 1 to 3).
2. **A fixed tool list per conversation.** A new tool is announced by name
   in a change note and loads on demand. The definitions change only at the
   next compaction. A model change starts a new conversation from a
   compaction.
3. **Compact while the cache is warm** (decision 28, below). Compaction on a
   session's engine runs only when the window is nearly full, which would
   leave every cold wake paying for the whole chat.
4. **Bulk stays out.** A session returns a short report. Long tool output
   goes to a file. Screenshots and images go to a helper, not into the
   agent's history.
5. **Cache lifetime by gap:** 5 minutes while people are chatting. An hour
   when the agent waits on a session, and on the last call of a turn that
   ends above the compaction size, so the cache is still warm when
   compaction runs.
6. **A cache miss is a bug.** Each prompt section gets a hash, logged per
   call, so a miss shows which section changed. Lor already counts cached
   tokens per run. Flag a call whose cached share drops.
7. **Later: warm the cache when someone starts typing** to the agent, so
   its first call is fast. Only if measured latency calls for it.

**Compaction** (Jacob, 11-18: as in Lee Robinson's talk)

Between compactions the history only grows: every tool call and result
stays in context, across turns.

| | Rule |
|---|---|
| When | A turn has ended, the prompt is above about 100,000 tokens, and about 10 minutes passed with nothing new |
| Not when | Background work is about to wake the agent anyway: a session about to report back, a `wake_up` due, a wake pending in the inbox |
| How | One call on the identical prefix (same tools, system prompt, model and settings) while the cache is warm, with the request to summarize added at the end. It calls no tools |
| Then | A new conversation: the same tools, a fresh snapshot of the profile and log, and a first message with the summary and the latest messages |
| Kept word for word | What people said and what the agent sent most recently |
| Left out of context, kept in the database | Everything else: earlier turns, tool calls and results, reasoning |

- **The summary keeps** what was asked, decided or ruled out, in people's
  own words; problems and how they were handled; where things stand; what
  is still open or promised; names, numbers, links and ids exactly.
  Anthropic publishes a summarization prompt built for this.
- **The kept messages go in as text** in the new first message, not as
  replayed turns. Opus 5.5 rejects earlier turns replayed after a summary
  with their reasoning attached, so this is required, not a style choice.
- **Reading back.** All compression is lossy, so nothing is deleted.
  `read_thread` already reads the chat and any session in full. A new tool
  searches and reads the agent's own history from before a compaction.
- **A long turn that fills the window** compacts in place between tool
  calls, as the session engine does today. This should be rare.
- **The cost:** the summary call reads a warm cache, so it costs about a
  twentieth of a cold read plus the summary's own output. The new
  conversation starts cold once. To be measured on the first build.

Lor already keeps instructions byte-stable per conversation, appends new
turns only, and puts elapsed time in the newest message.

These rules are Anthropic's. A channel on another provider's model caches
differently, and the first build step checks what Lor's agent and the
gateway send today.

## 9. The app

- **The channel page is the chat.** People and the agent write in it. A
  session shows as a card and opens beside the chat.
- **The composer says where a message goes:** to people, or to the agent
  when it is mentioned. With "wake on every message" on, every message goes
  to the agent.
- **Setup** holds the brief, the model, the tools, the triggers and Loops,
  and where the chat lives.
- **Activity** is the log.
- **The sidebar has two tabs:** what needs you with the sessions that are
  running, and the channels.
- **New session** starts a code session directly, as today.
- **Needs you:** an approval or question the agent sent also shows in the
  sidebar, because requests get lost in chat scroll.

From the mocks, these still apply: the chat with cards for sessions, a
session opening beside the chat, the two sidebar tabs, the direct code
session screen, and the guide for linking a chat app. These do not: a page
per agent with a list of threads, a thread per ask, and a separate Team chat
tab.

## 10. Discord

A channel's chat lives in one place. Linking a Discord channel moves it
there.

- **People type in Discord.** The Lor channel shows the same conversation
  read-only, with "Chat in Discord" where the composer was.
- **Sync runs one way.** The agent stores every message it receives, so Lor
  has the chat for reading and search. Nothing typed in Lor has to appear in
  Discord.
- **The agent speaks in Discord,** using Discord's reply.
- **Sessions stay in Lor.** The agent posts a card with a link.
- **Anyone in that Discord channel can talk to the agent.** Approving, or
  anything billed to a person, needs their Discord account linked to their
  Lor account. Approvals can be buttons on the agent's message.
- **Unlinking** unlocks the Lor composer. The Discord-era messages stay.

Left out at first: typing in Lor while Discord is linked,
and direct messages to the bot.

A Discord bot gets message text in direct messages and when mentioned with
no special access. Hearing a whole channel, which the wait lane needs, takes
the Message Content intent. That is a switch for a small app and needs
Discord's approval once an app is in 100 or more servers.

## 11. What exists and what changes

| Piece | Today | Change |
|---|---|---|
| Channel chat | People only. Lor never posts in it | The agent posts in it with `send_message` |
| Inbox | None. Triggers hold waiting events per session | New table, one worker per channel, two lanes |
| Webhooks and connector triggers | Post a card, or start or continue a session | Write to the inbox. Session modes go away |
| Loops | Start or continue their own session | Write to the inbox |
| Steering a running turn | Built on Lor's agent | Reused for a mention that arrives mid-turn |
| Chat sessions | A mode of New session | Removed from New session. Old ones stay readable |
| Code sessions | Started by people only | Also started by the agent. A finished one writes to the inbox |
| Tool access | One profile per channel, tools grouped as Read and Write | A narrower default for sessions the agent starts |
| Sandbox | Every run gets one on its first turn | The agent's turn starts one only when a tool needs it |
| Model | Picked in the composer, or the default | A model per channel |
| Channel brief and profile | None. Instructions exist per workspace only | New |
| Log and open block | None | New, derived from existing records |
| The agent's turn | Every Lor run goes through the session engine on Pi | A loop of Lor's own for the channel's agent: stored steps and a prompt built by hand. Sessions unchanged |
| Compaction | When the window is nearly full | For the agent: above about 100k tokens, about 10 minutes after a turn, on the warm cache. Sessions unchanged |
| Brain pages, search | Built | Unchanged. For the agent, the write-back pass becomes the memory pass on the warm cache (§7) |
| Approval rules | Per tool, per workspace | Unchanged. Add the order for who is asked, and record who set up a trigger |
| Discord | Only the webhook payload format | New: a bot, one-way sync, account linking |
| A persistent computer and repo per agent | None | Later |

## 12. Locked docs this changes

| Doc | Now | Becomes |
|---|---|---|
| `workspace-model.md` items 1 and 7 | Lor never posts in channel chat. `@Lor` there starts a session | The agent answers in the chat |
| `workspace-model.md` items 3 and 16 | Lor works in sessions next to the chat. New session has Chat and Code | Sessions are code only. The chat is where the agent works with people |
| `workspace-model.md` item 12 | The sidebar is the attention surface, with no inbox view | Two tabs |
| `act-sessions-runbook.md` | A session mode per trigger | Inbox lanes |
| `loops.md` | A Loop owns a recurring session | A Loop writes to the inbox |
| `lor-mvp-spec.md` | Write-back runs after each turn | For the agent, the memory pass on the warm cache. Sessions unchanged |
| `context-continuation.md` | Compaction at the window limit | For the agent, compaction on the warm cache after a turn |
| `harness-sessions.md` | Every Lor run on Pi, with a sandbox for every agent run | The channel's agent runs on Lor's own loop, with a computer on demand. Sessions stay on Pi |
| `slack-connector-next.md` | Never a bot in a chat app | A Discord bot first. Slack later, same shape |
| `positioning.md` | "The multiplayer runtime for your agents" | The thesis in §1 |

The October redesign took Lor out of channel chat because people could not
tell where to prompt it: a two-minute reply window and a model choosing
between the channel and a thread. Neither comes back. There is one place,
and a mention is explicit.

## 13. Build steps

Six slices. Each ends in something Jacob's team uses before the next starts.

**Before starting**

- [x] 0.1 What Lor sends for caching today, read from code 2026-11-18. Lor
  sets no cache lifetime, so Pi's default `short` applies: 5 minutes on
  Anthropic models. The Pi harness takes `cacheRetention: "long"` for one
  hour. A session key rides each gateway request, and
  `agent_run.cached_input_tokens` records the cached share. Where Pi places
  its breakpoints was not traced.
- [ ] 0.2 Count how many inbox events a day Jacob's own channels would have
  produced last week, by lane. Needs the production database.

**Slice 1: the agent answers in the channel chat**

After it: mention Lor in #eng and it answers there, using the channel's
tools.

- [x] 1.1 The inbox and its worker. Built 2026-11-18: `agent_inbox`
  (`packages/db/src/schemas/agent-inbox.ts`), the `agent-inbox` queue and
  `flushAgentInbox` (`apps/worker/src/lib/agent-inbox.ts`). One turn at a
  time, duplicates dropped on the message id, a 3-second batch delay. An
  item records the run that read it (`agent_inbox.run_id`).
- [x] 1.2 The agent's conversation, on its own loop (1.7 to 1.11). Built
  2026-11-19.
- [x] 1.3 `send_message` (`packages/lor/src/channel-agent.ts`), bound only on
  the agent's runs. Its posts are messages of type `agent_post`, the one
  kind of Lor message the chat feed shows. A retried step does not post
  twice (`SIDE_EFFECT_TOOLS`).
- [x] 1.4 Mentions and replies wake it, other messages wait unread
  (`apps/realtime/src/services/agent-inbox.ts`). The per-channel switch is
  `channel.agent_wake_mode`, set in the channel's Agent settings ("Answers":
  when mentioned or replied to, or to every message).
- [x] 1.5 A model per channel: `channel.agent_model`, picked in the
  channel's Agent settings from Lor's own models (batch-only ones left out,
  checked by the API with `isLorCreditModel`). Null runs on
  `CHANNEL_AGENT_DEFAULT_MODEL`, Opus 5.5 (`@repo/utils/inference`). A
  change mid-epoch misses the cache once and cuts old reasoning (checked
  live, 2026-11-19).
- [x] 1.6 No sandbox. The agent's turn never opens one. Its computer comes
  later (decision 29), started by the first tool that needs it.
- [x] "Lor is typing" in the chat while a turn runs. Realtime sends it the
  moment someone mentions or replies to Lor, the worker repeats it every 3
  seconds during the turn and pauses it after each post, and both apps drop
  a typer as soon as their message arrives. Not shown for turns nobody
  addressed (with "every message" on).
- [x] The "How Lor works" tour on web and mobile: "Lor answers in the chat"
  replaces the slide where `@Lor` started a session, and the sessions slide
  is now "Sessions for longer work".

**The agent's own loop** (built 2026-11-19)

`packages/lor/src/agent-loop.ts`, entered from `respond()` right after it
assembles the channel's tools, so the agent keeps the same tools, approval
rules, funding, billing and limits as any Lor turn, and skips Pi and the
sandbox. The worker side is `apps/worker/src/lib/agent-inbox.ts`: one queue
with three jobs, `flush`, `turn` and `compact`.

- [x] 1.7 Steps: `agent_step`, one AI SDK model message per row (the inbox
  text, each model reply, each set of tool results), append-only, never
  pruned, numbered per channel. `agent_context` holds the epoch, the frozen
  system prompt, and the last call's prompt size.
- [x] 1.8 The loop: one `generateText` call per step on the gateway, the
  system prompt frozen per epoch, the epoch's steps in order, the newest
  message last. Each call's reply and tool results are saved before the
  next call. A turn is an `agent_run` scoped to the channel, so one active
  run per scope gives one turn at a time, and the run's lease, spend limit,
  stop and billing work as for any run. The prompt has no sandbox lines and
  no session framing, and says plainly that the agent has no computer.
- [x] 1.9 Compaction as in §8: a turn that ends above 100,000 tokens
  schedules a `compact` job 10 minutes out; it runs only if no turn came
  after, nothing waits to wake the agent and no approval is open. The
  summary call reuses the epoch's prompt and tools (with nothing executable)
  and Anthropic's retention prompt. The new epoch opens with the summary and
  the last 30 chat messages word for word. A turn that fills 80% of the
  model's window compacts in place. `read_agent_history` reads any earlier
  turn by id, or finds turns by text.
- [x] 1.10 Approvals: gated calls come back from the AI SDK as approval
  requests. The turn ends, the rows are filed under a message in the chat
  ("I need an approval before I go on.") whose run shows the card, and
  approvers get the usual notice. A decided set flushes the inbox, which
  starts a run that answers the requests and goes on
  (`apps/api/src/routes/v1/approvals/handlers.ts`, `isChannelAgentRun`).
  Approved inputs are hashed in canonical form, since `jsonb` reorders
  keys. A crashed attempt is retried by the job and continues from the
  last saved step.
- [x] 1.11 The hidden session is gone: no `agent` session origin, no
  `agent_wake` line, and `lor-respond.ts`, `run-continuation.ts`,
  `lor-conversation.ts` and the session listings are back as they were.

Checked live on the dev database, 2026-11-19, in a test workspace: a
mention, plain messages waiting unread and read at the next wake, a turn
that searched and answered, a failed turn retried and then reported in the
chat, a turn interrupted by a worker restart, four approval pauses and
resumes in one request, a compaction, and a read-back of turns from before
it. The cached share per call was 0 at first, then 85 to 99%, see below.

**Found while building**

- **Anthropic rejected every Lor request.** `export_tool_result` was
  `strict` with a free-form `args`, which Anthropic's API refuses, so the
  gateway quietly fell back to other providers for all Lor runs, sessions
  included. Now `strict: false`. Direct Anthropic accepts the request since.
- **Cache misses came from provider routing.** The gateway caches per
  provider, and calls of one turn landed on different ones. The agent now
  asks for Anthropic first (`order: ["anthropic"]`) and logs each call's
  provider, input and cached tokens ("Agent model call"). In practice the
  gateway kept the test conversation on Vertex's Anthropic, with hits.
- **Reasoning is bound to the prompt.** Opus 5.5 signs its reasoning against
  the system prompt and tool list, and may refuse a replay after either
  changes. A tool set or model that changes inside an epoch moves
  `agent_context.reasoning_cut_seq`, and reasoning up to it is left out of
  the prompt (removing it from the front is allowed). If routing switches
  providers mid-conversation, replayed reasoning may also be refused; not
  seen yet.
- **The approval card needed a live listener in the chat.** The channel
  page now keeps approvals live (`useChannelApprovals`).

**Deviations and gaps in slice 1**

- A mention that arrives mid-turn waits for the next turn. It does not steer
  the running one.
- While a turn waits on an approval, new wakes wait too.
- Every pause posts its own line in the chat ("One more approval before I go
  on." after the first). A turn with many gated calls is noisy.
- A run swept as dead does not flush the inbox. The next wake does.
- Nowhere yet to see a turn's steps (Activity, slice 5).
- Today's write-back pass still runs for the agent. Slice 4 replaces it
  with the memory pass.
- The one-hour cache lifetime on large conversations is sent as an Anthropic
  provider option through the gateway; whether it applies was not checked.
- A failed turn, or a workspace out of credits, is told in the chat only
  when a person asked (decision 30). A Loop's or an event's failed turn
  shows in its run history.

**Decided for this batch (2026-11-21)**

- Where a channel's chat lives: a "Chat" choice at the top of the channel's
  Agent settings, Lor (the default) or a linked Discord channel (Slack
  later). Linking shows the Discord conversation read-only in Lor, locks the
  composer behind "This chat lives in Discord", and sends the agent's posts
  there (decision 22). Built in this batch (decision 35, step 7.5).
- How the agent looks: a creature from a pixel-art bestiary, with its own
  name per channel (decisions 32 and 33, steps 7.2 and 7.3). Mock:
  `shared-team-agents/mock/bestiary.html` in the 2026-11-20 session.

**Owed before the batch ships**

- `db:push` on each environment. The dev database got this work's tables,
  enums and columns by hand on 2026-11-19 (the full push stopped at an
  unrelated prompt to truncate `brain_node`).
- `.lor/environment.json` has no worker service, so the Browser tab's Start
  buttons run the app without agents. The worker has no port to list.

Done 2026-11-19 with the flag's removal: on web and mobile, `@Lor` in the
channel composer shows "To Lor" instead of "New session in #channel", the
Chat and Code picker is gone from the channel composer, and the placeholder
and the first-run hint say Lor answers in the chat.

**Slice 2: it runs coding agents**

After it: "look at my Linear issues and get started" starts sessions and
reports back in the chat.

- [x] 2.1 `start_session`, `check_session`, `message_session`,
  `stop_session` (`agentSessionTools` in `packages/lor/src/channel-agent.ts`,
  run by `apps/worker/src/lib/agent-session-tools.ts`). Built 2026-11-19.
  - A session the agent starts is `agent_session.origin = "agent"`: a code
    session on a repo the channel's profile allows (`channelCodeRepo`), on
    its own `lor/` branch from the repo's default branch or the one asked
    for, on Lor's own agent (Pi). The person who woke the agent is
    subscribed.
  - The agent's brief, and each follow-up, is an `agent_task` line in the
    session, the turn's request. Sessions show it as a message from
    "#channel's agent", and the session page says "Started by the channel's
    agent".
  - Called without a repo, `start_session` lists the repositories, or says
    why there are none (GitHub not connected, unreachable, or code not
    allowed in the channel).
  - `message_session` refuses while the session is working; `stop_session`
    stops a working turn the way the Stop button does.
  - At most 15 of the agent's sessions working at once in a channel.
- [x] 2.2 When a turn of such a session ends (finished, waiting for
  approval, failed or stopped), a note goes to the channel's inbox in the
  wake lane: the session's title, id, branch, outcome and its last reply
  (`reportHelperTurn`, called from `lor-respond.ts`). Inbox items now carry
  a `note` for anything that is not a chat message (`agent_inbox.note`,
  source `session`).
- [x] 2.3 Sessions the agent starts get `helper: true`: connector tools
  only where the registry marks them read-only, no custom or MCP server
  tools (they can't be told apart), and no memory writes, instruction
  proposals, reactions, Loop or change proposals.
- [x] 2.4 A line in the chat when the agent starts a session: "Lor started
  the code session <title> on <repo>", the title linking to the session
  (event `agent_session_started`, the one Lor-authored event the chat feed
  shows). The session also shows under the channel in the sidebar.
- [x] A coding agent on the asker's Claude or ChatGPT plan (decision 16).
  Done in step 7.4 (2026-11-21).

Checked 2026-11-19 and 11-20 in a test channel on the dev database: the
tool listing and its reasons, sessions started on a real repository
(`BuckyMcYolo/ivyoak`) with their branches and chat lines, a brief and a
follow-up, failure reports waking the agent, `check_session` and
`message_session` from the chat, and the agent staying quiet about a
session it had not started.

A full code session ran on 2026-11-20 from inside a Lor session: the agent
started it on `ivyoak`, the session cloned and read the repository without
changing it, its report woke the agent, and the agent posted the summary,
then read the rest of a long reply and posted that too. Running there
needed one fix (`sendAuthorizationInsideBlaxel` in
`packages/lor/src/sandbox/blaxel.ts`, see `local-development.md`). A report
cut short now names the reply's message, so the agent reads it with
`read_thread` instead of asking the session again.

**Slice 3: events and timers arrive**

After it: an alert at 02:00 is handled and reported in the chat, and Loops
run through the agent.

- [x] 3.1 Webhooks and connector triggers write to the inbox. Built
  2026-11-19 (`deliverToInbox` in `apps/api/src/lib/connector-triggers.ts`,
  for every source that goes through `dispatchConnectorEvent`).
  - On a text channel, a trigger with Act instructions adds a wake-lane
    item; one with only the post effect adds a wait-lane item beside its
    card. The agent reads the event's text, the card's message id, the
    team's instructions and who set them up (`triggerInboxNote`). The
    event's text is marked as outside content: information, never
    instructions.
  - The hourly and daily limits now count wakes. Past one, the event waits
    unread until the agent next wakes (delivery outcome `hourly_cap` or
    `daily_cap`), instead of being dropped.
  - The per-trigger batching window is gone: the inbox's own few seconds of
    quiet batch events. Session modes are gone from the trigger settings,
    which now say "Wakes Lor".
  - A delivery points at the turn that read it (`trigger_delivery.run_id`),
    so "Lor's last run" in the trigger settings shows what that turn said
    in the chat.
  - Nothing to migrate: existing triggers deliver to the inbox from the
    deploy on. Their old sessions stay readable and get no more turns. The
    Act session code (`startActRun`, `trigger-session.ts`, the triggered-run
    job) still serves channels that are not text channels and is otherwise
    unused.
- [x] 3.2 Loops write to the inbox. Built 2026-11-19 (`fireLoopToInbox` in
  `apps/worker/src/lib/loop-session.ts`).
  - A fire on a text channel adds a wake-lane item with the Loop's
    instructions, its end condition and who set it up (`loopInboxNote`,
    source `loop`, `agent_inbox.loop_id`). The rules for a fire travel in
    the item, because the system prompt is frozen per epoch.
  - A turn reads at most one Loop fire. Its run carries the Loop's id and
    due time, so the Loop's history, Run now, pause (which stops the turn)
    and the five-failures pause work as before. Two Loops due together run
    as two turns.
  - A fire is skipped while the Loop's previous fire is unread or running.
    A fire of a Loop paused, completed or deleted since is not read.
  - `propose_loop` is on for the agent: the draft card posts in the chat,
    and a teammate activates it. It refuses on a turn no person started,
    so a trigger or a Loop can't schedule more Loops. Activation makes no
    session on a text channel.
  - `complete_loop` for the agent names the Loop, and works only for one
    with an end condition. No line in the chat: the Loop's card shows it
    completed, and the agent says what it stopped in its own words
    (decision 30, 2026-11-20). A Loop paused after five failures still says
    so in the chat, since nothing else would show people it stopped.
  - The fire's note and the agent's prompt tell it to post as if it noticed
    things itself, never mentioning the Loop, a schedule or being woken,
    and to stay quiet when there is nothing worth saying.
  - What a turn said in the chat is saved as the run's note, which the
    Loop's history and the trigger settings show.
  - Nothing to migrate: existing Loops fire into the inbox from the deploy
    on. Their old sessions stay readable and get no more turns.
- [x] 3.3 Who an approval asks on a turn no person started. Built
  2026-11-19 (`requesterOf` in `apps/worker/src/lib/approval-notify.ts`):
  the creator of the Loop that fired, else whoever last saved the trigger
  whose event woke the agent (`connector_trigger.configured_by_id`, set on
  every save), else the workspace's approvers as before. The rule's named
  approver still comes first.
- [x] 3.4 New session is code only. Chat sessions become read-only history.
  Built 2026-11-19.
  - New session, on web and mobile, starts code sessions only: the Chat and
    Code switch and the chat examples are gone, and the server refuses a
    session start without a repository (`sessionStartFor` in
    `apps/realtime/src/services/lor.ts`). The orphaned
    `lor-start-mode.tsx` is deleted.
  - A chat session is read-only: its composer becomes a line ("Chat
    sessions are read-only. Ask Lor in #channel.") with Open chat, fork and
    rewind are off, and the server refuses new messages, forks and rewinds
    in it. Code sessions stay open whatever started them.
  - "Ask Lor about this" replies to the message with `@Lor` in the
    composer instead of opening New session (the channel route's `about`
    search param). A meeting recording's questions do the same, and
    Setup's questions open the channel with `@Lor <question>`. The agent's
    inbox line for a reply carries the replied-to message.
  - `@Lor` in a human thread wakes the agent and it answers in that thread
    (default 3, not objected to). So does a quote-reply to Lor, or any
    reply in a thread under one of Lor's messages; other thread replies do
    not reach it. A turn answers in one place, the chat or one thread,
    which its first wake picks; wakes from elsewhere wait for the next
    turn. Typing shows in that thread. The thread composer's pill says "To
    Lor".
  - `propose_workspace_change` is on for the agent. The card posts in the
    chat (never in a thread), it refuses on a turn no person started, and
    a decision is posted in the card's thread as before and now wakes the
    agent there. The chat shows proposal cards.

Checked 2026-11-19 in the test channel on the dev database: a webhook event
waiting unread, a failed deploy waking the agent and a successful one leaving
it quiet, the hourly limit downgrading an event to unread, a Loop drafted in
the chat, activated, run with Run now, posting its summary, and completing
itself once someone said the pipeline was fixed; "Ask Lor about this"
answered in the chat with the replied-to message in view; `@Lor` in a thread
and a plain reply in a thread under Lor's card answered in those threads
with no session made; New session showing Code only; an old chat session
read-only; a workspace change proposed in the chat, approved, and followed
up in the card's thread.

**Deviations and gaps in slice 3**

- A thread turn's approval line and card show in the main chat: approval
  cards only render where the run's thread matches, and agent runs have
  none.
- A proposal's decision names what it created but not the new ids, so the
  agent can't edit a new webhook in a follow-up proposal without looking it
  up. Sessions get the same message.
- Mobile changes are type-checked, not run on a device.
- The legacy Act session and Loop session code stays for channels that are
  not text channels.

**Slice 4: it remembers and stays cheap**

After it: the chat can run for weeks without growing, and the agent knows
the channel.

- [x] 4.1 The channel profile. Built 2026-11-20
  (`packages/lor/src/channel-profile.ts`).
  - The brief is `channel.agent_brief`, written in the channel's Agent
    settings (needs `channel:update`, like the model and wake mode). Facts
    are `channel_agent_fact` rows: text, source, date, the person who last
    edited one, and a soft delete so the next turn can be told it is gone.
    The Agent settings list them; anyone who can see the channel may edit or
    delete one through the API (`/channels/:id/agent-facts`), though the
    settings tab itself still needs `channel:update`.
  - Both go into the system prompt snapshot, frozen per conversation. The
    brief is presented as the team's instructions, the facts as information
    of uneven weight.
  - Change notes: the newest message of a turn starts with what changed in
    the brief or facts since the agent's last turn
    (`agent_context.notes_through`). A conversation not frozen yet gets the
    profile in its snapshot instead.
- [x] 4.2 The memory pass. Built 2026-11-20 (`agentMemoryPass` in
  `packages/lor/src/agent-loop.ts`, run as mode `memory` through
  `respond()`).
  - Right after a turn, in the turn's job but after the next turn is free
    to start. It reuses the turn's context, so the tools, system prompt,
    model and gateway session match and it reads the turn's cache. It reads
    the history up to the end of that turn, plus the current facts with
    short ids and the request (`memoryPassRequest`).
  - It returns fact changes in a closing `<facts>` block (add, edit, remove,
    by id), applied within 100 facts and about 4,000 characters. It edits
    brain pages with the memory tools only. Every other tool is refused, and
    so is a memory tool an approval rule covers. Up to six calls.
  - Facts a person edited in settings are marked, and the pass leaves them
    as written unless they are wrong. It writes dates, not "this week".
  - Write-back no longer runs for the agent. The brain-page bar and page
    format are shared with write-back (`packages/lor/src/brain-rules.ts`,
    write-back's prompt unchanged byte for byte).
  - Skipped for a turn paused on approvals (its continuation gets one) and
    for a turn a person stopped. Usage folds into the turn's run and bills
    like the turn.
- [x] 4.3 The log and the open block. Built 2026-11-20.
  - The log (`channelAgentLog`) is in the snapshot: the last 7 days from
    records, up to 40 lines, oldest first. Events with their source and
    first line, Loop runs, session reports, sessions the agent started,
    approvals and who decided them, and its posts per day.
  - The open block (`openBlock`) starts each turn's newest message: the
    agent's sessions still working, approvals people haven't decided, and
    the channel's Loops with their next run. Wake-ups join it in slice 5.
- [x] 4.4 Compaction size and wait, from measured cache numbers
  (2026-11-20). No change yet; numbers and options below.
- [x] 4.5 The standing cache check. Built 2026-11-20.
  - Every call logs its cached share, provider, and any provider that
    refused it before the gateway fell back. A call that should have been
    warm (not the first of a turn, or the first within the cache lifetime
    of the last turn) and read less than half its prompt from cache logs
    "Agent cache miss" with the provider before and after, the system and
    tools hashes and the reasoning cut. Each turn logs "Agent turn cache".
  - Per turn in the database: `agent_run.cached_input_tokens` over
    `agent_run.input_tokens` for runs with `scope_key` = the channel (turn
    and memory pass together).

**What the cache check found on its first day (2026-11-20)**

- Since slice 3, every agent request was refused with a 400 by Anthropic,
  Claude on AWS and Bedrock: `propose_loop` is a strict tool and its
  `endAfter.amount` was `z.number().int().min(1).max(365)`. Anthropic's
  strict tools reject integer bounds, and zod's `int()` emits the
  safe-integer bounds anyway. The gateway fell back to Vertex, which drops
  `strict`. Fixed: a plain number, checked when the tool runs.
- The gateway's session affinity then kept every channel agent on Vertex.
  Without a session id it fingerprints the prompt's opening and puts the
  pinned provider ahead of `order`. On Vertex the first turn of a
  conversation sometimes missed the cache two calls in a row. Fixed: one
  gateway `sessionId` per conversation (channel and epoch), shared by its
  turns, memory passes and compaction, which also pins the exact
  credential.

**Measured (dev database, Opus 5.5, prompts of 20k to 46k tokens)**

- Within a turn, calls after the first read 92 to 99% from cache, on one
  provider.
- The first call of a turn read the cache only when the previous turn
  ended under 5 minutes before. Every wake after a longer gap was a full
  write: about $0.10 at 20k tokens, $0.23 at 46k, $0.50 at 100k (writes at
  $5 per million on the 5-minute cache).
- The memory pass read 92 to 99% from cache: one more cheap call per turn,
  about 200 output tokens. A turn plus its memory pass was 82% cached
  overall on a channel's first turn.
- No conversation reached 100k, so compaction's own cost is still
  unmeasured.

Options for the cold first call, not built: the 1-hour cache on the last
call of every turn (writes at 2x; the Anthropic docs don't say whether
re-marking a cached prefix re-bills it, so measure first), a keep-alive
read while a channel is active, or a lower compaction size (60k would cut
each cold wake by 40% and compact more often). Pick from production gaps:
the share of turns logged with `coldFirst: true`.

Checked 2026-11-20 on the dev database:
- A brief written in settings reached a new conversation's snapshot.
- "Remember that Zoe owns the deploy pipeline and Priya reviews every
  migration" became two facts sourced to the person who said them.
- A fact edited in settings reached the next turn as a change note, and
  the agent answered from it.
- The log rendered for a channel with events, Loop runs and approvals.
- After both fixes, every call went to Anthropic with no refusals, and the
  memory pass read warm.

**Deviations and gaps in slice 4**

- The settings tab that lists facts needs `channel:update`, so other members
  can't reach the edit and delete the API allows them.
- A person can't add a fact in settings, only edit or delete one. They ask
  Lor to remember it instead.
- Mobile has no Agent settings yet: no brief or facts there.
- The log is a snapshot, so a conversation that never compacts keeps the
  log from when it started. Change notes cover the profile, not the log.

**Slice 5: it follows up by itself**

After it: "I'll check in an hour" happens, and nothing unread waits more
than half an hour.

- [x] 5.1 `wake_up` and its scheduler. Built 2026-11-20.
  - `wake_up` (a note, and `inMinutes` or `at` with an offset, from a
    minute to 30 days out) and `cancel_wake_up`, on every turn of the
    agent. Rows in `agent_wake_up`: due time, note, the turn that set it and
    the person who woke that turn. At most 20 pending per channel.
  - The minute sweep that runs Loops also fires due wake-ups
    (`sweepDueWakeUps` in `apps/worker/src/lib/agent-wake-ups.ts`): each
    becomes a wake-lane inbox item (source `wake_up`) carrying the note,
    then is marked fired. A crash between the two repeats safely.
  - Pending wake-ups are in "Open right now", fired ones in the log.
    Compaction waits when one is due within 15 minutes. Approvals on a
    wake-up's turn ask the person who woke the turn that set it.
  - Follow-ups: the channel's overview panel lists pending wake-ups under
    the Loops ("Lor checks back 7:48 PM", with the note), and anyone who
    can see the channel can cancel one (`/channels/:id/agent-wake-ups`,
    live through `agent:wake-ups:updated`). Wake-ups and Loops stay
    separate (Jacob, 11-20).
  - The chat never says a wake-up woke the agent (decision 30). A wake-up
    turn answers in the chat, even when the wake-up was set in a thread.
- [x] 5.2 The check-in Loop on every channel. Built 2026-11-20
  (`packages/lor/src/check-in.ts`).
  - A Loop of kind `check_in` ("Check-in", every 30 minutes all day since
    2026-11-20; at first 9:00 to 18:00 on weekdays), made once per text
    channel: when the channel is
    created, or on its next chat message for channels made before
    (`channel.agent_check_in_at` marks it, so a deleted check-in stays
    deleted). No card in the chat.
  - A fire does nothing unless something waits unread and no wake is
    pending; otherwise it wakes the agent with the Loop's instructions, and
    the unread items come first in its inbox. Its runs show in the Loop's
    history and count toward the five-failures pause.
  - Its zone, which matters only if someone narrows it to working hours, is
    the one a person pinned on the workspace's latest Loop, else UTC:
    nothing stores a workspace's or person's zone.
  - Schedules of the form "every 15, 30 or 60 minutes between two hours on
    chosen days" now read as words ("Every 30 minutes from 9:00 AM to 6:00
    PM on weekdays") and are editable in the Loop panel ("Through the
    day": how often, from, until, days), so people change the check-in's
    hours there, or pause or delete it.
- [x] 5.3 Needs you, and the two tabs. Built 2026-11-20.
  - The sidebar has two tabs, Needs you and Channels (the choice is kept
    per device). Needs you carries a count of what waits on the person.
  - Needs you lists the channel agents' approvals the person can decide
    (with the card's description) and questions the agent asked them by
    mention in the last week that they haven't answered (nothing from them
    since, in that place), then sessions waiting on them, then sessions
    running. A row opens the message or the session.
  - The activity snapshot carries `agentNeeds` per channel. It refetches
    when a turn ends and when the person posts in a channel with a question
    waiting.

Checked 2026-11-20 on the dev database:
- "Check back with me in 2 minutes" set a wake-up with a useful note. It
  showed under Follow-ups and fired at the next minute, and the agent
  followed up in the chat on its own, with no mention of a timer.
- The check-in was made on a channel's next message. Run now with nothing
  unread did nothing. With an unread message it woke the agent, which read
  it and stayed quiet.
- The check-in's panel showed its hours as words, with editable rows.
- Needs you showed a pending web-search approval and a question Lor asked
  by mention, kept up to date as the turn ended and when I replied.

**Deviations and gaps in slice 5**

- The check-in's zone is a guess (the workspace's latest Loop, else UTC)
  until a workspace stores its zone. It matters only for working hours.

**How often other agents wake themselves (read 2026-11-20)**

Only OpenClaw publishes a default: a heartbeat every 30 minutes, all day
unless `activeHours` is set, with `NO_REPLY` as the quiet answer. Grok Bot
has no default heartbeat; routines run on a schedule at least five minutes
apart, or on events. OpenAI's Dots decides itself when to check back, plus
schedules people set and events, with read-only background research.
Meta's Muse runs background jobs and interrupts only when it judges it
worth it. Hermes has no self-wake by default; its monitor mode skips the
model when nothing changed. A third-party guide calls hourly common and
15 minutes the fast case. Builder.io's Grok Bot reviewer spent $100 in a
weekend mostly on wakes that found nothing, and recommends events over
clocks. Lor's check-in skips the model when nothing is unread, so its
cadence costs nothing on a quiet channel.
- "Answered" means the person wrote anything in that place since the
  question, which can clear a question too early.
- Mobile has no Needs you tab, Follow-ups or "Through the day" editor yet.
- A wake-up set in a thread turn answers in the chat.

**Slice 6: Discord**

In this batch (Jacob, 2026-11-21; parked on 11-18). After it: the team
talks to the agent in its Discord channel. Jacob tests on his own server.

Built 2026-11-21; not yet tried against a real Discord server (waiting on
the bot's token in the session env).

- [x] 6.1 The bot, linking a channel, and one-way sync. One gateway
  connection, held by one API process through a Redis lease
  (`apps/api/src/lib/discord/gateway.ts`; intents: guilds, guild messages,
  message content). No interactions endpoint: slash commands and buttons
  arrive over the gateway, so nothing public is needed. Linking: the Agent
  tab's Chat section makes a one-time code (15 minutes, Redis), and someone
  with Manage Channels runs `/lor link code:…` in the Discord channel, which
  proves they can manage it. The bot then makes a webhook there wearing the
  creature, stores `channel_discord_link` (token encrypted) and says hello.
  `/lor unlink` or "Move back to Lor" removes it. Messages there mirror into
  the Lor channel (`inbound.ts`): a linked person posts as themselves,
  anyone else as the app user with their Discord name and avatar (a DISCORD
  badge in Lor); the bot's mention becomes Lor's, replies map through
  `discord_message`, and the message goes to the agent's inbox like a chat
  message (a mention or a reply to the agent wakes it).
- [x] 6.2 `send_message` posts in Discord too, through the webhook under
  the agent's name (split at 2,000 characters; Lor mentions become Discord
  mentions for linked people, names otherwise; citations drop). A failed
  Discord post is told to the agent. Typing shows in Discord while it works.
  The Lor composer becomes "This chat lives in Discord" with a link, and
  realtime refuses chat messages there; sessions stay in Lor.
- [x] 6.3 Account linking with `/lor connect`: a private link to
  `/discord/connect` signed for that Discord account (15 minutes), opened
  while signed in to Lor (`discord_account`). Approvals the agent parks get
  Approve and Reject buttons in Discord; a click by a linked person goes
  through the same `resolveApproval` as Lor's card.

People mention the agent by its own name (2026-11-21, Jacob): linking also
makes a mentionable role named after the agent (@Inky), held only by the
bot so it pings no one, renamed with the agent and deleted on unlink
(`syncAgentRole`). Mentioning the bot itself (@Lor) still works. This adds
Manage Roles to the bot's permissions; a server that added it before must
add it again, and until then only the bot's mention works.

Deviations: the agent posts through a webhook, so its messages can't use
Discord's reply (webhooks can't); it mentions the person instead. The
webhook avatar follows the creature (re-uploaded on change), since a
per-message avatar needs a public image URL. Not done: mobile's composer
lock (the server refuses the send), private threads, DMs to the bot, edits
and deletes in Discord, and attachments beyond links.

Discord threads (2026-11-21, Jacob, before the batch ships): a public thread
under a linked channel mirrors as a Lor thread (`discord_thread`). Its root
is the Lor copy of the thread's starter message, or the thread's first
message when the starter was never mirrored. The API keeps the bot's public
threads from GUILD_CREATE and THREAD_* events (`apps/api/src/lib/discord/
threads.ts`) and joins new ones in linked channels. In a thread the agent
wakes by Lor's own thread rule (a mention or @role, a reply to it, or a
thread under one of its messages) and answers there: its posts, typing,
notices and approval buttons go to that Discord thread. It doesn't start
threads itself. Lor's thread panel shows "This thread lives in Discord"
where the composer was. Typing in threads adds Send Messages in Threads to
the bot's permissions.

**Slice 7: before the batch ships** (Jacob, 2026-11-21)

After it: each channel's agent has its own name and creature, code
sessions run on people's own Claude or ChatGPT plans, and the batch can be
deployed.

- [x] 7.1 `dev` merged in (2026-11-21, left staged): one conflict, and the
  per-Loop and per-trigger model pickers removed (decision 31).
- [x] 7.2 Named agents (decision 32, built 2026-11-21). The agent stays
  one Lor user per workspace. `channel.agent_name` and `agent_creature`
  (null: derived from the channel id by `channelAgentIdentity` in
  `@repo/utils/bestiary`, a creature and one of its default names), and
  `agent_identity_updated_at` for the change note. Clients swap the name in
  at render time under `ChannelAgentProvider` (web) or the channel layout's
  provider (mobile): posts, replies, @mentions, the mention picker, the
  composer's placeholder and hint, typing, the member list, Needs you and
  the header. Session views have no provider, so Lor stays Lor there.
  Notifications for its posts carry the name (`speaksAsAgent` in the
  worker). The agent's prompt names it, and a rename reaches it as a change
  note at its next turn. The channel's creator may set the name and
  creature too, like its name and topic.
- [x] 7.3 The bestiary (decision 33, built 2026-11-21; touched up the
  same day at Jacob's ask to stay playful but look less childlike: no
  blush, smaller eyes under short brows, smirks instead of wide smiles):
  10 creatures (dragon, griffin, owl, golem, ghost, slime, fox, mushroom,
  clanker, kraken), 24x24 pixel art with an eyes-shut frame, in
  `@repo/utils/bestiary`. The web `AgentCreature` draws them as SVG and
  animates the real state in whole sprite pixels: asleep (eyes shut, a
  breath, floating z), working on every turn (hops, sparkles; the worker
  beats `agent:working`), needs you (a "!" badge), a blink otherwise; old
  posts stay still and reduced motion stops it all. Picked in the Agent
  tab with the name. `creaturePng` renders a PNG for Discord, emails and
  push. Mobile draws them still for now.
- [x] 7.4 Sessions on Claude Code and Codex only (decision 34, built
  2026-11-21). New session offers only those two, and the server refuses a
  start on any other harness or without a repository. The agent's
  `start_session` takes an optional harness and runs the session on a
  person's plan: who asked, else the Loop's creator, the person behind the
  wake-up, or whoever saved the trigger. Claude Code is picked when they
  have Claude connected, else Codex; with neither, the agent is told to ask
  someone. Its turns in that session run on that person's plan (the
  session's `creatorId`); a person writing in it uses their own. "Continue
  with Lor" is gone. Older sessions on Lor's own agent keep working, and
  Loop and Act sessions on voice channels still run on it.
- [x] 7.5 Discord (slice 6, decision 35) with the chat-location choice
  (built; live test owed with Jacob's bot).
- [ ] 7.6 The rollout checklist (written 2026-11-21; run at deploy):
  1. `db:push` on each environment, answering No to the `brain_node`
     truncate prompt. It adds `agent_inbox`, `agent_step`, `agent_context`,
     `agent_wake_up`, `channel_agent_fact`, `channel_discord_link`,
     `discord_message`, `discord_account`, the channel agent columns
     (`agent_model`, `agent_wake_mode`, `agent_brief*`, `agent_check_in_at`,
     `agent_name`, `agent_creature`, `agent_identity_updated_at`) and the
     Loop `kind`, and drops `loop.model` and `connector_trigger.act_model`
     (decision 31).
  2. Optional env: `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` on the
     API and worker (Message Content intent on, no interactions endpoint).
     The invite asks for eight permissions, `275683298368`.
     Without them Discord stays hidden.
  3. Redeploy API, realtime, worker, web/desktop and mobile together; drain
     the worker first so no old-code turn runs.
  4. What existing data sees: every text channel gets a derived name and
     creature, and its check-in Loop on its next message. Old Lor chat
     sessions stay readable; older sessions on Lor's own agent keep working.
     Loops and triggers lose their model picks and run on the channel's
     model.

**Later**

- A persistent computer and its own repo per agent.
- Agents messaging each other.
- Slack, in the same shape as Discord.

## 14. Risks, and how we will know it works

| Risk | What the sources reported | What we do |
|---|---|---|
| Quiet wakes cost money | One reviewer's bots spent $100 in a weekend deciding there was nothing to say | The wait lane, batching, the check-in skipped when nothing is unread |
| Forgotten follow-ups | "I'll get back to you", then nothing woke the bot | `wake_up` is the only way to promise |
| One context for everyone | Each bot's single conversation became a bottleneck | Accepted. Compaction and memory carry it, and code goes to sessions |
| When to speak is unsolved | Grok Bot's own team says they do not have it right yet | Start quiet. Tune the brief, not code |
| Untrusted input meets write tools | Webhook bodies and issue text reach the agent | The workspace's approval rules, as today. Stored memory never instructs |
| Hidden memory | Memory rewritten where the reviewer could not see it | Facts are listed in the channel's settings with their source and date, and anyone can edit or delete one |

Numbers to watch:

- Wakes per channel per day, and the share that end quietly (from slice 1).
- Cost per wake, and the cached share of each turn.
- Follow-ups that came due against those the agent promised.
- Changes that reached main that were started by someone other than the
  engineer who merged them, or by an event.

## Sources

Read 2026-11-18. The Grok Bot material is third-party; xAI has published no
harness documentation that I found.

- Anthropic: [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents),
  [Effective harnesses for long-running agents](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- OpenClaw: [heartbeat](https://docs.openclaw.ai/heartbeat),
  [group messages](https://docs.openclaw.ai/channels/group-messages),
  [system events](https://docs.openclaw.ai/cli/system)
- Lee Robinson's Stanford CS146S talk, through write-ups:
  [Franklin Javier](https://franklinjavier.com/blog/how-always-on-agents-work/),
  [Reducer notes](https://reducer.xgoose.org/items/4705),
  [Peter P](https://www.peterp.me/articles/what-actually-happens-when-you-message-grok-bot/).
  The video's transcript could not be read. §4 and the compaction rules
  in §8 follow the first two (re-read 2026-11-18).
- Anthropic's API reference for caching and compaction on Opus 5.5: cache
  lifetimes and prices, the summary call on the parent's prefix, and why
  kept turns cannot be replayed with their reasoning after a summary
- [Builder.io's review of Grok Bot](https://www.builder.io/blog/grokbot-review)
- LangChain: [ambient agents](https://www.langchain.com/blog/introducing-ambient-agents)
- [Navan](https://navan.com/blog/build-proactive-ai-agents) on deciding when
  to interrupt, and Tian Pan on
  [always-on architecture](https://tianpan.co/blog/2026/04/17/ambient-ai-architecture-always-on-agents)
- Inngest: [background agents](https://www.inngest.com/blog/background-agents-are-here-your-orchestration-isnt-ready)
- Discord: [gateway intents](https://docs.discord.com/developers/events/gateway)
- Not read: the agento.host heartbeat deep dive, whose server returned
  errors.
