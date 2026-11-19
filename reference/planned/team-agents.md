# Team agents: always-on agents for your team

**Superseded 2026-11-18 by `reference/always-on-agents.md`,** which is the plan. This
doc is kept as the record of how the design was reached, through eight
revisions. The mocks at `/prototype/agents` and `/prototype/orchestration`
follow §5 here, not the plan. Where the two docs differ, the plan wins.

**Status:** Proposal, 2026-11-16, for LOR-169. Not locked, nothing here is
built unless §9 says so. Written from Jacob's brief (LOR-169 and his
2026-11-16 reply): a channel groups an always-on agent, its connectors, tools
and prompts, and an optional chat; canvas comes later; personal agents such as
Grok Bot need a stance. §11 lists the locked docs this would change. §12 lists
the decisions still open, each with a recommendation.

**Revised 2026-11-17** after Jacob's second reply (torn on Lor in channel
chat, wary of a noisy Activity tab, "we built around chat, and the next Slack
won't look like that"). Three changes: general chat leaves the default product
and conversation stays attached to work (§3.4); the Activity tab becomes a
Home that shows work, with the full log behind it (§4); Slack and Discord get
an integration that notifies and links, never a conversation (§7).

**Revised again 2026-11-17 (interface).** Jacob liked the direction but found
the first prototype's board ugly, and asked for a simple chat that becomes
dynamic when it needs to, as Grok Bot and Dots do. §4 now describes that: a
roster of agents, one shared chat per agent with work as cards, and a panel
that opens beside the chat in the shape the work needs. The Home board is
gone. Lor now posts in the agent's chat, which changes `workspace-model.md`
item 1 (§11).

**Revised a third time 2026-11-17 (the Grok Bot team's interview).** Jacob
asked whether a message in the agent's chat reaches everyone, and pointed to
YC's Lightcone episode with two of Grok Bot's builders. §4 now makes your chat
with an agent yours and the work it starts the team's, gives every session an
owner, gives every watch a trust level, and puts proof ahead of the diff. The
lessons and their source are in "What the Grok Bot team's interview changed".

**Revised a fourth time 2026-11-17 (orchestration).** Jacob: it still felt
off, and the part to nail is the orchestration between where the chat lives
(Lor or not), the always-on agent and the code sessions. §5 is rewritten
around that and is now the core of this doc. It separates the thread from the
code session, puts threads in Slack as well as in Lor, and overrides parts of
§3.4, §4 and §7 (listed at the end of §5). A step-through of it is at
`/prototype/orchestration`.

**Revised a fifth time 2026-11-17 (the agent is a teammate).** Jacob
corrected two things in §5. A session is the coding agent, like a cloud coding
agent a person kicks off, and the chat with the agent in the channel is the
thread. And the agent is a teammate with a teammate's tools: its own
general-purpose computer, and the ability to command a swarm of coding
sessions, each with its own dev box. §5 is updated.

**Revised a sixth time 2026-11-17 (the room, and events).** Jacob settled the
shape. Channels stay, and each one is an agent. It is not only for code: every
agent is an always-on orchestrator for one area, wired to sources, events and
timers, with its own computer and its own repo, running its own small team of
coding agents, on a person's subscription when they allow it. Team chat is
hidden for now. Two things were left: where events go once the chat is
hidden, and how team chat and other chat apps fit. §5 answers both in "Events
arrive at the agent" and "The room". Both are proposals until Jacob agrees.
The earlier "the channel is a chat" proposal stays below them as history.

**Revised a seventh time 2026-11-18 (sessions, the sidebar, the Chat tab).**
Jacob agreed to the room and raised three things: telling what needs
attention apart from the agents in the sidebar, what the main chat with a
channel's agent is, and keeping "New session" as it works today. §5 answers
them in "Two kinds of session", "The agent's page" and "The sidebar". The
prototype is rebuilt to match.

**Revised an eighth time 2026-11-18 (a thread is not a session).** Jacob
pushed back on making the chat with the agent a session: it would inherit one
repo, a fixed mode and a fixed coding agent, and the agent should sit a layer
above sessions and use them like a tool. He also asked what the room is for
if people talk to the agent in threads. §5 now has "A thread is not a
session" and "What the room is for", and the prototype is corrected.

**Prototype, rebuilt 2026-11-18:** `/prototype/agents` in the web app (dev
only, `apps/web/src/components/prototype/agents/`), on made-up data, so the
screens can be judged before anything is built. It follows §5: a sidebar with
a Work tab and an Agents tab; an agent's page with the box to ask it for
something, what it watches, everyone's work, and a Team chat tab for the room
(linked to Slack, not linked, or Lor's own chat); a thread where the agent
starts code sessions, reports back, and adds sessions in other repos as the
conversation goes on; a code session beside its thread; and New session, a
code session a person starts directly.

## 1. Thesis

Every assistant a team can use today is personal. ChatGPT, Claude, Grok Bot,
Dots and Muse each work for one person, on that person's account, with that
person's memory. A team of ten has ten private agents and no shared one.

**Lor is always-on agents for your team, with the team's context and memory in
one place.**

- **Always on.** Each area of the company has an agent that watches its tools,
  acts when something happens, and comes to people only for a decision.
- **For the team.** The team sets it up once. Everyone sees its work, anyone
  can step in, and the right person approves what goes out.
- **One place.** What the agents learn, what the tools say and what the team
  decided belong to the workspace, not to someone's account. They stay when
  people leave.
- **With a team of its own** (Jacob, 2026-11-17). Each agent has its own
  computer and repo, and runs coding agents (Claude Code, Codex, on the team's
  own plans) to do the work and to build its own tools. That holds in every
  area, not only engineering: code is how an agent works, not the market Lor
  is in.

Lor is not a replacement for the team's chat app, a bot inside that chat app,
a personal assistant, or only a coding tool.

### The next Slack is not a chat app

Lor was built around chat, on the idea of being the next Slack. The idea holds
if it is read correctly. Slack mattered because it made the team's work
visible to the team. Work with AI is now the part nobody can see: it happens
in private tabs and reaches the team as pasted text.

So the shared place a team needs next is for its agents' work, and its unit is
a piece of work, not a message.

- **The main object is the session,** not the channel message.
- **People talk about the work, on the work,** as they do on a pull request, a
  Linear issue or a Figma file. None of those is a chat app, none asks a team
  to leave its chat, and none is called a bot. Each is where one kind of work
  lives, and each sends links to the chat app.
- **What was built for chat carries over.** A session is a thread under an
  anchor message (`agent_session`), so realtime, mentions, presence,
  notifications, subscriptions and mobile all serve sessions already.

### What it looks like

A ten-person startup, three channels. The team still chats in Slack.

- **#eng.** At 02:10 an error alert arrives from Better Stack. The #eng agent
  reads it, finds the pull request that caused it, starts a code session, fixes
  it on a branch and runs the app. In the morning Ana has one item under
  "Needs you", and the same item as a link in Slack: approve the draft pull
  request. She opens the session, sees the diff and the running app, asks for
  one change, approves. Theo joins the session to ask why the retry changed,
  and Ana answers him there.
- **#support.** A customer reports the export button looks idle. The #support
  agent drafts a reply for approval and hands the bug to #eng. The #eng agent
  starts a session, and its result goes back to the #support session with a
  link.
- **#gtm.** Every Monday the #gtm agent checks new signups against the CRM and
  leaves a list. Rafael opens a session and tells it to draft outreach for the
  top five. It starts five sessions, follows them and reports back.

### How long the thesis holds

Checked 2026-11-16 from press coverage, not vendor pages (sources at the end).
Re-check against vendor pages before any of this reaches marketing copy.

| Product | Owner of the agent | Notes |
|---|---|---|
| Grok Bot (beta 2026-08-11) | One account | All of an account's bots share one cloud computer, files and logins. Desktop and iPhone apps only. One unofficial site reports a later Team Bots beta with Slack presence; unverified |
| Muse, Meta (2026-09-08) | One person | A small-business variant followed on 2026-09-29 |
| Dots, OpenAI (2026-09-29) | One person: "A personal dot acts for one user" | Reached from ChatGPT, Slack and Teams. Specialist Dots with their own organizational identity and credentials are in pilot. ChatGPT Space is a shared place for people and Dots |

"Personal" is true of what teams can use today, and the labs are already
moving to team agents. "For your team" opens the pitch. It cannot be the whole
defence. What stays Lor's when they ship team agents:

1. **The team owns the context.** Open source (AGPL-3.0), memory in the team's
   workspace, readable and searchable by the team.
2. **Any model and any agent.** Lor's agent, Claude Code and Codex today. A
   lab's product runs that lab's models.
3. **The work can be reviewed, not only reported.** A session holds the diff,
   the running app, the plan and the approval. A chat message cannot.
4. **A real boundary per area.** Each channel has its own audience, tools and
   memory, and each session its own computer.

## 2. The model

```
Workspace   the company: people, connections, memory, billing
└─ Channel  one area of work (#eng, #gtm, #support) and who can see it
   ├─ Agent     always on: its brief, what it watches, what it may do
   ├─ Setup     connectors and tools, prompts, repos, files, memory
   └─ Sessions  the work, started by the agent or by a person.
                People talk here, about the work
```

General chat is not part of the model. It stays available as a workspace
setting, off by default (§3.4).

| Noun | Meaning | Today |
|---|---|---|
| Workspace | The company. Owns connections, memory, people, billing | Built |
| Channel | One area of work and its audience. The unit of permission | Built as a chat channel with a tool profile |
| Agent | The channel's standing agent: Lor with this channel's brief, tools and memory. One per channel | Not an object. Implied by the channel's tool profile, Loops and triggers |
| Session | One piece of work with its own context, computer and history. Multiplayer: people talk to Lor and to each other in it | Built, chat and code modes |
| Team chat | General human-only talk, not tied to a piece of work. Optional | Built, always present |

Projects keep grouping channels, as now.

## 3. The channel

### 3.1 Agent

One agent per channel. Not one per person and not one for the company.

- **Why per channel.** Tools, memory and audience are already scoped to the
  channel, and a session is safe to share because it has the channel's
  audience (`workspace-model.md` item 8). A company-wide agent would hold every
  tool and serve every audience at once.
- **It is Lor.** "Lor in #eng", not a cast of named bots. One identity keeps
  trust, memory and the words simple. A channel may rename its agent later.

| Part | What it is | Today |
|---|---|---|
| Brief | Standing instructions for this channel: the job, what matters, who to ask, what never to do. Versioned; Lor's own edits wait for approval, like LOR.md | New. Instructions exist only for the workspace (`workspace_instructions`). A run gets the channel's name and topic |
| Watching | What wakes it: tool events, webhooks, schedules | Built: connector triggers, channel webhooks and Loops, each with its own instructions |
| Authority | Which tools need approval and who approves. Each watch also has an owner and a level (observes, prepares, acts, owns) that rises with trust | Approvals are built for the workspace (`approval_policy`), and a channel-scoped approver is planned there. Owners and levels are new |
| Memory | The channel's pages plus the workspace's | Built (`brain_node.scope_channel_id`) |
| Computer | One sandbox per session, not one per agent | Built |
| Chat | Its one shared conversation: what it did, what it is doing and what needs you, as messages and cards (§4) | New surface over existing sessions |
| Log | Every event that came in and what it decided. Opened from the chat's header, never the default view | New surface over existing rows (deliveries, runs, approvals) |

**What "always on" means.** Always reachable and always watching. It does not
mean a computer running all day (`beta-pricing-runbook.md`: do not promise
always-on environments on current sandbox costs).

The agent wakes on four things:

1. an event from a tool (trigger or webhook);
2. a schedule (Loop);
3. a person (`@Lor`, New session, a message in a session);
4. another channel's agent (handoff, §5). New.

On each wake it does one of four things and records which in the Log:

- **Pass:** seen, not acting, with a one-line reason.
- **Note:** save to memory or add to a session that is already open.
- **Work:** start or continue a session.
- **Ask:** needs you, a question or an approval.

Pass and Note are new. Today an event with Act always runs in a session, and
every run starts a sandbox. A short triage pass without a sandbox is what keeps
a noisy feed from producing a session per alert.

### 3.2 Setup

| Part | What it is | Today |
|---|---|---|
| Connectors and tools | Which connected services, MCP servers and custom tools this channel's agent may use | Built: `agent_profile`, resolved channel, then project, then workspace default. Shown as "Agent Profile" in the channel dialog |
| Prompts | Saved prompts the team reuses here: a name, the text, optional arguments. Run from "/" in the composer and from New session; a Loop or trigger can point at one | New. Lor's agent already runs repository prompt files as "/" commands (`skills-and-commands.md`); prompts stored in the workspace are not built |
| Repos and environments | Repositories and dev environments code sessions may use | Built: the workspace's GitHub installation, allowed when the channel's tools include `clone_repo` |
| Files and memory | Shared files, the channel's memory pages | Built |
| People | The channel's audience: the workspace or chosen members | Built |

Instructions then have four layers, most general first: workspace (LOR.md),
channel brief, the instructions on one trigger or Loop, and a prompt someone
runs.

### 3.3 Sessions

Unchanged from `workspace-model.md`. Two additions: a session can be started
by another session (§5), and a new kind of work is a new session mode (§6).

### 3.4 Where people talk

General chat leaves the default product. Conversation stays, attached to work.

| Kind of talk | Where |
|---|---|
| To the agent | The agent's chat. A plain message goes to Lor |
| To a teammate, about a piece of work | In its session, by mention. Lor stays out (the routing rule in `workspace-model.md` item 14) |
| To Lor, about a piece of work | In its session. The owner steers and others suggest |
| Agent to the team | Its chat, notifications and a digest (§7 for Slack) |
| Agent to agent | A handoff, shown in both sessions (§5) |
| Everything else: small talk, announcements | The team's own chat app, or Team chat in Lor when it is turned on |

Why:

- **Lor in a general chat failed because every reply to it went to
  everyone.** Keeping Lor out left a second Slack with nothing of Lor's in
  it. In the agent's chat Lor posts only results and asks, and replies about
  a piece of work go in that work's thread, so the chat stays short and the
  detail stays with the work.
- **"Everyone included" does not need chat.** It needs every teammate to have
  a seat, see every agent's work, be able to step in, and be reached when they
  are needed. The agent's chat, work threads and notifications do that.
- **No agent chat room.** A stream of agents talking is a log with the same
  noise problem, and it has no natural home (#gtm or #eng?). People want the
  request and the result, on the work they belong to.

**The chat that stays is your chat with the agent, and the session.** What
you type to the agent is yours. Each piece of work is a session that everyone
in the channel can open and write in, and it notifies only its subscribers:
whoever started it, was mentioned, wrote in it or was added
(`workspace-model.md` pass, decision 4). The work is visible to everyone and
pushed only to the people involved.

**A people-only Team chat stays as a workspace setting, off by default.** The
code and data are kept, as with DMs and voice. When it is on, each channel has
a Chat tab
and every rule in `workspace-model.md` holds: people only, Lor never writes
there, `@Lor` starts a session.

**The cost.** Chat was also a source of context. With it off, the team's
conversation has to be read from where it happens, so Slack reading (§8) stops
being optional.

**Event feeds.** Webhook and connector posts are what the agent watches. Their
home is the Log, each event shown with what the agent did about it. They still
appear in Chat when it is on.

## 4. The app

### Sidebar

```
Northstar

For you                                        2

Eng        Needs you: Fix export retry
Support    Needs you: Reply to Paygrove
GTM        14 teams signed up last week…
Design     Not set up yet
```

- **A roster of agents,** each with its latest line and its state, like a
  list of chats. Sessions are not in the sidebar.
- **For you** lists what is waiting on you across every agent.
  [PR #239](https://github.com/Lor-Labs/Lor/pull/239) (open) builds the
  cross-channel list it needs.

### An agent is one chat

The channel page is your conversation with the team's agent. The agent, its
memory and its work are shared. The scroll of what you typed is yours.

- **Lor speaks when people need it:** a result, a question, an approval, a
  digest. Events it passed on never appear. The Log, opened from the header,
  has everything.
- **Prose when prose fits, a card when it does not.** A piece of work is a
  card that shows its steps live. An approval is a card with the button on
  it. Numbers come as a chart, choices as a list to tick, a customer reply as
  a draft. Lor picks the form from a fixed set (§6 for generated ones).
- **A card is a session,** the same object as today. The chat is a surface,
  not one long context. Each card has its own context, its own computer and
  its own chat with Lor, so work stays separate and runs side by side (§5).
  Sessions moved from a sidebar list into the agent's chat.
- **Your chat is yours, the work is the team's.** Only you see what you
  type. The session it starts is open to the whole channel, and a teammate's
  work shows in your chat as one line you can open. What Lor does on its own
  (an alert it acted on, a digest, an ask) shows for everyone.
- **Nobody waits.** Each ask starts its own session, so two people can ask at
  the same moment and both get to work at once. Only inside one session does
  Lor take one turn at a time.
- **One box.** A message goes to Lor, which answers or starts work. People
  talk to each other inside sessions.
- **Steering and talk about one piece of work happen in its session,** opened
  from the card. They notify the people in that session, not the channel.
- **Every session has an owner:** the person who asked, or the owner of the
  watch that started it. Everyone can write in a session. The owner's word
  settles it, and Lor treats what others say as suggestions and checks with
  the owner before it changes course.
- **Proof before the diff.** A card that asks for approval leads with the
  work running (a preview, a screenshot, a number), and the changes are one
  tab away.
- **Only "needs you" notifies,** as now (`workspace-model.md` item 12).
- **Setup happens in the chat.** A new agent asks what to look after and
  proposes its watches, tools and approval rules as a card to approve.

### What the Grok Bot team's interview changed

Source: YC Lightcone, "The Rise Of AI Coworkers", 2026-11-14, with Lauren Tan
and Roman Ugarte of Grok Bot. YouTube would not serve the video to the
sandbox, so this comes from three write-ups of the episode, not the
transcript (Sources). Quotes are as those write-ups give them.

| What they said | What it changes here |
|---|---|
| Grok Bot's Team Bots documentation, as one write-up quotes it: a shared bot is "one Bot, not a copy per teammate", and direct chats with it are private. The owner and managers control what it learns | Your chat with an agent is yours. The agent and its work are shared. Someone owns each agent and decides what goes into its memory |
| Their real collaboration moved into shared threads. Tan built a feature in a roughly 200-message thread with a colleague and a PM: "I didn't even look at Cursor for this project" | The session is that thread, with the diff and the running app beside it. It stays open to the channel and multiplayer |
| Ugarte: "There are so many unsolved problems still in making bots multiplayer." A bot in a group thread is like "an employee who has no EQ and no social awareness of the room": it cannot tell who has the authority | Do not wait for the model to learn it. Give Lor the structure: an owner per session, an owner per watch, and approval rules that name who may say yes |
| Access should grow with trust: read-only first, then tasks, then outcomes. One write-up names the stages Observe, Prepare, Act, Own | Each watch has a level: observes, prepares, acts, owns. "Lor never commits" is the prepares level, not a rule for ever (§5) |
| Tan reviews the artifact, not the diff, and her agents merge their own pull requests once checks pass | Approval cards lead with the work running. Merging on green checks is the acts level, earned per watch |
| Execution is cheap, so deciding is the bottleneck. The team declines most finished pull requests to avoid "a bit of a Frankensteiny product". Tan points automation at bugs, performance and small fixes | Maintenance is the right first job (§10). For anything that changes the product, Lor proposes in a sentence before it builds, and "needs you" has a limit per agent |
| A bot should be "obsessive about a thing", a hire who cares about one problem, not one superhuman generalist | One agent per channel stays (§3.1) |
| Bot-to-bot messages are visible, and Tan's personal bot asked a team's data bot a question | Handoffs stay visible in the session (§5), and a personal agent talking to a team's agent is the client case in §7 |
| Identity and permissions for bots are unsolved everywhere. Grok Bot inherits a person's credentials, as onboarding a hire would | Lor's connections belong to the workspace, not to a person. That stays the difference, and it is not solved here either |

One thing the interview cuts against. Their shared threads are in Slack and
on X, where their team already is. That supports the session as the unit and
is a reason to start sessions from a Slack thread sooner than phase 4 (§7).

### The panel beside the chat

Opening a card slides a panel in beside the chat. Its shape follows the work.
(§5 changes what the panel holds: the thread, with the agent's computer and
each session's dev box one level below.)

| Work | The panel shows |
|---|---|
| Code | The session's chat, the changes, the running app |
| A draft | An editor, with sending behind approval |
| Numbers | The chart and its breakdown. It can be pinned to the top of the chat |
| The agent itself | Setup, and the Log |
| Later | A document or a canvas (§6) |

The conversation never changes shape and never switches mode. That is how the
product becomes dynamic without a model deciding where people's messages go.

Both patterns have prior art (read 2026-11-17, see Sources). xAI's design post
on Grok Bot describes one transcript per agent with inline cards and widgets
where prose does not fit, and a pinned side panel for the agent's computer.
Dots keep one continuous thread with a second pane for the agent's computer.
Lor's difference is the audience: the chat, the cards and the panel are the
team's, not one person's.

### Setting up a channel

Two ways, both ending in one reviewable change:

- Pick a template: Engineering (errors to fixes), Support, GTM, blank.
- Tell Lor the outcome ("investigate every error alert and propose a fix").
  Lor proposes the channel, webhook, trigger or Loop, tools and approval rules
  as one change proposal (built: `change-proposals.md`). A person approves.

## 5. Orchestration: the thread, the agent, the sessions

### What the Grok Bot team's own habits say

From the write-ups of their interview (§4), read for what they do, not only
what they say.

- **They built an app for their bots and still do most of their work in Slack
  threads.** People work where they are already together. The agent's own app
  is for setting it up and for looking at its computer.
- **One thread ran to about 200 messages** between an engineer, a colleague
  and a PM, and nobody opened the editor. The unit of work is a long
  conversation that several people steer. The coding tool is out of sight.
- **The agent brings clips and screenshots back to the thread, and merges its
  own pull requests when checks pass.** People judge the result, in the
  conversation. Reading a diff is the exception.
- **A coordinator agent runs the sub-agents.** The thing people talk to is not
  the thing that writes the code.

In Lor today a session is all of it at once: the conversation, the agent's
loop and the computer. That fusion is what kept feeling off. This section
separates them.

### Three layers

```
The thread           the chat with the agent in a channel, in Lor or in Slack
       |  messages down, status and results up
The agent            a teammate that is always on, one per channel: brief,
                     memory, tools, and its own general-purpose computer
       |  starts, steers and checks
Sessions             coding agents, as many as the work needs. One branch and
                     one dev box each. They change the code and return proof
```

| Layer | What it is | In today's code |
|---|---|---|
| Thread | One piece of intent, talked through by people and the agent. Long-lived, multiplayer, with an owner | Closest today: a chat session, a thread under a hidden anchor message (`agent_session`, mode `chat`). It gets its own shape and is not a session ("A thread is not a session") |
| Agent | The channel's always-on agent: Lor with the channel's brief, memory, tools and computer | Not an object (§3.1) |
| Session | A coding agent on its own branch and dev box | A code session, which only a person starts today |

**Their Slack thread is our thread with the agent. Their cloud coding agent
is our session.** The word "session" now means only the coding agent. Chat
sessions stop being a separate thing: talking to the agent is a thread, and
what a chat session did with its sandbox the agent does on its own computer.

### The agent is a teammate

Give it what a teammate has (Jacob, 2026-11-17). Grok Bot's builders state the
same principle: bots get the tools a person uses.

| A person on the team | The channel's agent |
|---|---|
| Is in the channel and talks in threads | The same |
| Has a laptop: a browser signed in to the team's tools, files, a terminal | Its own computer, general purpose, that keeps its files and logins |
| Looks at the product, a dashboard or a customer's account before deciding | The same, on its computer |
| Kicks off cloud coding agents and reviews what they return | Starts sessions, as many as the work splits into, and checks their proof |
| Remembers what the team decided | Memory (§8) |

### Two kinds of computer

| | The agent's computer | A session's dev box |
|---|---|---|
| How many | One per agent | One per session |
| Lives for | As long as the agent. It sleeps when idle and wakes on work | As long as the session |
| For | Everything a teammate does that is not changing a repository: looking at the live product, dashboards and tools with no API, research, files, scripts, checking a session's proof | One branch of one repository: change the code, run the app, prove it works |
| Holds | The agent's files, its own repo of tools and scripts, and the team's logins for it | A checkout, a dev server, a browser for the preview |
| Who can look | Anyone in the channel can watch and take over | Anyone in the channel can open it or take it over |
| Today | Not built. Sandboxes belong to sessions and are deleted after 7 days idle | Built: the code session's sandbox and browser |

The agent has a repository of its own (Jacob, 2026-11-17): the tools, scripts
and packages it builds for itself. Keeping them in Git is what makes the
computer last, because the computer can be rebuilt from the repo.

The agent does not change a product repository on its own computer. That
keeps every product change on a branch someone can review and throw away.

### How one piece of work flows

1. Someone asks in the channel and mentions the agent. Or an alert or a
   schedule wakes the agent and it starts the thread itself. That message is
   the top of a thread.
2. The agent wakes with the thread, the channel's memory and what else is
   open in the channel. It can look for itself on its own computer. It
   answers, asks a question or starts one or more sessions.
3. Each session works on its own branch and dev box. The thread shows one
   status line per session, updated in place.
4. The session returns proof: a clip or screenshot of the app working, a
   preview link, the size of the change. The agent posts it as one card.
5. People reply in the thread. The agent passes each instruction to the
   session it concerns and says so. The session runs again and the card
   updates.
6. When checks pass, the agent asks the person who may approve, by name, in
   the thread. They approve there.
7. The agent opens the pull request, or merges at a higher trust level. It
   writes what was decided to memory and tells any agent that was waiting.

### Rules

1. **One agent per channel,** on every surface the channel is linked to, with
   one memory.
2. **The agent replies only in threads.** It posts at the top of the channel
   only to start a thread for work it began itself.
3. **A thread is stored in Lor whatever the surface,** so memory and search
   hold all of it.
4. **The agent works on its own computer and never changes a repository
   there.** Code is changed in sessions, one branch and one dev box each. A
   thread can have many, one after another or side by side.
5. **A session shows in the thread as one status line and one result card.**
   Never a stream of tool output.
6. **A reply in the thread goes to the agent.** A reply to a result card
   steers that session. The agent says what it did with each instruction.
7. **Sessions wake the agent** when they finish or get stuck. They never ping
   people.
8. **Approval is asked and given in the thread,** on either surface, by the
   people the approval rules name.
9. **Opening a session shows its dev box:** the changes, the running app,
   the terminal. Opening the agent shows its computer. Both are in Lor only.
   What a person does there is noted in the thread in one line, so the thread
   stays the record.
10. **The agent knows every open thread and session in its channel.** It
    joins a duplicate to the existing thread instead of starting again.
11. **Every thread has an owner** (§4), and the trust level decides how far
    the agent goes alone.
12. **A private chat with an agent exists for questions.** Work that starts
    there opens a thread in the channel.

### Events arrive at the agent

Jacob, 2026-11-17: webhooks were built to match Slack and Discord so that an
event in a channel could dispatch an agent. With the chat hidden, does a team
set them up twice, or does Lor now depend on the chat app's webhooks?

Neither. A webhook never needed the chat. As built (`automation-primitives.md`
§3) it belongs to a channel, its trigger has two effects (POST a card, Act),
and its URL already takes Lor's, Discord's and Slack's payloads (`/discord`,
`/slack`).

- **The webhook is the agent's address.** The channel is now the agent.
  Nothing changes in how a webhook is made or what it accepts.
- **POST starts a thread.** The card goes at the top of the agent's page,
  where it used to go into the chat. Act is the agent answering under it.
- **Lor sits in front of the chat app.** A team that sends an alert to Slack
  today changes that URL to the agent's `/slack` URL. The agent passes the
  alert on to the linked Slack channel, so it still shows there, and answers
  in its thread. The relay is new.
- **Connected tools need no webhook.** GitHub, Linear, Attio and Better Stack
  events come with the connection.

| The team has | What they do | Depends on the chat app |
|---|---|---|
| A connected tool | Nothing more | No |
| An alert that goes to Slack today | Change one URL to the agent's | No |
| Alerts they will not move | Let the agent listen to that Slack channel. Later, and optional | Yes |

### The room: where the team talks is attached to the agent

Proposal, 2026-11-17, after Jacob's "maybe the team chat is a tab on the
agent". It replaces the recommendation in the next subsection, which put
people and the agent in one timeline.

A channel is an agent, and its page is the agent's threads. The team's own
chat is a room attached to the agent. One of three things fills it:

| The room is | When | In Lor |
|---|---|---|
| Nothing | At launch, with no chat app linked | The Chat tab is the guide to linking one |
| A Slack or Discord channel | The team links one | A label in the header that opens it |
| Lor's own chat | Later, behind the launch flag | A Chat tab on the agent |

The agent behaves the same in any room:

- It reads the room and speaks only when mentioned, in a thread under that
  message (rule 1).
- It posts at the top level only to start a thread, for an event or for work
  it began itself.
- It asks for approval by name, in the thread.
- Every thread is stored in Lor and listed on the agent's page, whatever room
  it started in.
- A thread started on the agent's page stays in Lor. The agent or a person
  can post its result to the room.

The agent's page lists threads: who or what started each one (a person, an
event, a timer), its latest line, and whether it needs someone. A composer
starts a new thread. Threads are open to the channel and notify only the
people in them. Events the agent ignored are in the log, not on the page.

Why a room and not one timeline:

- **The product is whole with no room.** That is what puts Lor in the bucket
  "agents for your team" and not "chat app".
- **Team chat and "works in other chat apps" become one feature.** Slack fills
  the room now. Lor's chat can fill it later with no change to the agent's
  page or to a rule.
- **It is close to what is built.** Channel chat is already people only, with
  Lor working beside it (`workspace-model.md`). The default view moves from
  the chat to the agent, and the chat goes behind the flag.
- **It is cheap to change.** A tab and one timeline are two views of the same
  channel messages.

### A thread is not a session

Jacob, 2026-11-18, correcting the revision before this one, which made the
chat with the agent a session of the `chat` kind so the existing table could
be reused. That inherits the wrong shape. Think of the product as a team
chat, an always-on agent and cloud coding agents combined: the agent sits one
layer above the coding agents and uses them like a tool.

What a session fixes when it starts today (`agent-sessions.ts`):

| Field | Today | Wrong for a conversation with the agent because |
|---|---|---|
| `mode` | `chat` or `code`, fixed. "Continue in Code" makes a second session | A conversation starts as a question and may turn into code, or never does |
| `repoFullName`, branches | One repo, fixed | One piece of work can touch several repos, or none |
| `harness` | Fixed, "a session never switches" | The agent is always Lor. Each code session it starts can use a different coding agent |
| Sandbox and environment | One dev box per session | The agent has one computer of its own, shared by all its threads |

So there are two things, with two shapes:

| | Thread | Session |
|---|---|---|
| What it is | A conversation with a channel's agent about one piece of work | One coding agent on one branch of one repo, with a dev box |
| Belongs to | The agent | A thread when the agent started it. The channel when a person did |
| Repo, branch, mode, harness | None | Fixed at the start, as today |
| Computer | The agent's own | Its own dev box |
| Started by | A person on the agent's page, a mention in the room, an event, a timer | The agent, with a tool. Or a person, with New session |
| Holds | Messages, the people in it, an owner, and links to the sessions it started | The transcript, the changes, the running app |
| In Slack | A thread | A status line and a result card in that thread |

- **The flexibility lives in the thread, so sessions can stay simple.** A
  thread can have no sessions, then one, then five across two repos. Nothing
  changes type, because the thread never had one.
- **Sessions are tools to the agent:** start one (repo, coding agent, whose
  plan, the ask), send it a message, read where it is, stop it, hand it to a
  person. Starting a second one in another repo is how "add a repo" works.
- **New session stays as it is:** one coding agent in one repo, started by a
  person, with no agent above it.
- **Today's chat sessions become threads** with the channel's agent. "Session"
  then means only the coding agent (decision 17).
- **What can be reused is the engine, not the shape.** Runs, plans and
  sandboxes key on a thread's root message, not on the session row
  (`agent-sessions.ts`), so durable runs, steering and stopping can serve a
  thread without making it a session.
- **Many threads per agent, not one long chat.** Several people can work with
  the agent at once, each thread keeps its own context, and the agent's
  memory and computer are shared across them.

### What the room is for

Jacob, 2026-11-18: if people talk to the agent in threads, what is the chat
for, in Slack, Discord or Lor?

A thread is the same thing wherever it starts. Asked on the agent's page, it
is quiet: open to the channel, and nobody is told. Asked in the room, it is a
thread under a message that the team sees go by. The room is not a second way
to talk to the agent. It adds three things threads alone cannot:

| The room gives the agent | Without it |
|---|---|
| Ears: what people say to each other, which is where decisions and complaints are | It knows only what tools emit and what someone tells it directly |
| A voice to the team: an alert it triaged, a result, a request to a named person | Its work reaches only people who open Lor |
| A door: mention it where people already are, and the thread starts there | People have to leave their chat to use it |

- A team with no room linked loses nothing in the product. It gets a quieter
  agent that knows less.
- This is the multiplayer part. A thread in the room is how a colleague and a
  product manager end up in the same piece of work without being invited.

### How the agent reaches out

Jacob, 2026-11-18. Reaching out is not a new mechanism: the agent starts a
thread, the same thing a person starts by asking. It never acts on a whim.
Something wakes it:

| What wakes it | State |
|---|---|
| An event from a tool, or a webhook | Built (triggers) |
| A timer | Built (Loops) |
| A session it started finishing, failing or asking a question | New (the wake in "What it needs") |
| Something said in the room | New, with the room |
| A follow-up it set itself, such as "check the deploy in an hour" | New |

Each time it decides three things:

| | Options | Decided by |
|---|---|---|
| Who it is for | The owner of the watch that fired. The owner of the thread it is about. The people allowed to approve | Setup and approval policies |
| Where it goes | The room, as one post that starts a thread, when the team should see it. One person, as a direct message in Slack or as "Needs you" in Lor with a push, when one person has to act. Its own page only, when it handled the thing itself | What kind of news it is |
| How loud | Silent. Posted with no ping. A ping to one named person | The watch's trust level and how urgent it is |

Rules that keep it from becoming noise:

1. **Three reasons only:** it needs a decision, it has a result, or something
   is wrong that a person should know. Everything else goes to the log and
   the digest.
2. **One thread per subject.** More of the same event adds to the thread it
   already opened (built: `per_subject`, `act-sessions-runbook.md`).
3. **One named person, never the whole channel.** With no answer it reminds
   once, then goes to the next person or to the room.
4. **It says why it is speaking:** "From a Better Stack alert", "On its
   Monday schedule".
5. **It waits its turn.** Events queue while people are talking in the thread
   (built: waiting events).
6. **Quiet hours and a cap per room per day.** What is over the cap waits for
   the digest, unless the watch is marked urgent.
7. **"Less of this" on any post changes the watch.** The agent proposes the
   change to its setup and a person approves it once.

Joining a conversation between people is the "Speaks up" level of the room,
off at first. When on, it replies once, in a thread under the message, as an
offer ("This looks like LOR-171. Start on it?"), never in the flow of the
chat.

Already there for delivery: notifications to a session's subscribers, to
approvers and to people mentioned, with push, mutes and per-person settings
(`workspace-model.md` item 12). New: an owner per watch, posting to a linked
room and direct messages there, follow-ups the agent sets itself, reminders
and escalation, quiet hours and the cap.

### The agent's page

| Part | What it holds |
|---|---|
| The box | "Ask Eng to do something". It starts a thread. This is the main way to talk to the agent |
| Always on | What it watches, each with its trust level |
| Work | Everyone's threads in the channel, each with the sessions it started, and the sessions people started directly |
| Team chat tab | The room |
| Setup, Activity | Behind two buttons in the header |

The Team chat tab is always there, and it is also the guide:

- **No room linked:** it asks where the team talks and walks through linking
  Slack or Discord, or turning on Lor's own chat.
- **Slack or Discord linked:** how the agent behaves there, and what it took
  from the room today, so people can see what it hears.
- **Lor's own chat:** the people-only chat. A mention of Lor is answered in a
  thread linked under the message.

How far the agent goes in the room is a setting, in three steps:

| Level | What it does |
|---|---|
| Listens | Reads the room and remembers what was decided. Never writes |
| Answers when mentioned | Replies in a thread under the message. The default |
| Speaks up | Also replies, in a thread, when it can help and nobody asked. Later |

- **One room per agent at a time.** Moving from Slack to Lor's chat is
  unlinking one and turning on the other. People's messages are never copied
  between them, so there is nothing to keep in step.
- **Threads outlive the link.** Every thread with the agent is stored in
  Lor, so unlinking Slack loses none of the work.

### The sidebar

Two tabs (Jacob, 2026-11-18):

| Tab | Shows | Order |
|---|---|---|
| Work | Yours across every agent: the threads you are in and the sessions you started | Needs you, Running, Recent. The tab carries the count that needs you |
| Agents | Every channel's agent, with its state and where its room is | Fixed |

- A thread shows the strongest state of the sessions under it, so an approval
  always surfaces at the thread. Its sessions list under it when it is open.
- An agent's row shows "Needs you" or how many sessions are running, so
  attention is visible from either tab.
- New session stays above the tabs.
- This replaces `workspace-model.md` item 12 ("The sidebar is the attention
  surface. There is no inbox view"), which already allowed for a
  cross-channel list of your sessions once sidebars got too long.

### The channel is a chat, and an exchange with the agent is a thread

Superseded by "The room" above, kept as history. The table of when the agent
takes a message still holds inside a room.

Open, discussed with Jacob 2026-11-17. His lean: the channel is a chat with
the agent that can also make threads, so that long term the team can chat
there too, and so that it works the same in Lor and in every chat app. This
is the proposal that keeps both futures open.

| Where | The agent takes it when | How it answers |
|---|---|---|
| A channel, at the top level | It is mentioned. Or always, in a channel set as the agent's own | In a thread under that message |
| A thread the agent is in | Always, unless the message mentions a person | In the thread |
| A private chat with the agent | Always | Inline, as one running chat. Work it starts opens a thread in the channel |
| Work the agent began itself | | One post at the top level, then the thread under it |

- **It reads as chat.** Lor shows a thread's first answer inline, right under
  the message. A quick question looks like a message and its reply. The
  thread only looks like a thread once it grows: status lines, result cards,
  more people. Slack, Discord and Teams show it their own way ("1 reply").
- **People can talk in the channel.** A message that does not mention the
  agent is for people, and the agent stays out. So the same channel can
  become where the team chats, in Lor, without changing any rule.
- **One switch per channel:** the agent answers only when mentioned (the
  default), or answers every top-level message (for a channel that is mostly
  the agent). Whether each chat app lets an app hear every message in a
  channel has to be checked per app. Mentions and threads work in all of
  them.

Why the agent never replies as a plain message at the top level:

- Lor did that before October. It needed a 2-minute reply window and a model
  choosing between channel and thread, and `workspace-model.md` lists both as
  the reason people could not tell where to prompt Lor.
- With several people asking at once, flat replies interleave.
- A follow-up needs no mention inside a thread. In a flat chat every
  follow-up would need one, or a guess.

Still open, and not needed to start: whether Lor's own chat becomes the
team's chat (a question of adoption, not of design), and how a message
written in Lor shows up in a Slack-linked channel.

### Where the chat lives

| | Chat in Lor | Chat in Slack |
|---|---|---|
| Channel | A Lor channel | A Slack channel linked to a Lor channel |
| Thread | Native | A Slack thread, mirrored into Lor |
| The agent's messages | Messages and cards | Messages, cards and buttons |
| Status, results, approval | In the thread | In the thread |
| The agent's computer, a session's dev box | Open beside the thread | Links that open Lor |
| Memory, search, setup | Lor | Lor |

The agent, its memory, its computer, the sessions and the place to open the
work are Lor's on both. Slack is one of two places a thread can live. That is
different from being a bot that lives only in Slack, and it is where Dots and
Grok Bot already are, so it is the entry price and not the difference (§1).

### What it needs

| Piece | State |
|---|---|
| A thread under a channel message | Built. The anchor is hidden and has to show |
| `@Lor` in a channel starts a session with the recent conversation | Built |
| Code sessions with a branch, a computer, a browser and preview links | Built (preview links owe a `db:push`) |
| Triggers and Loops that start sessions | Built |
| The agent's own computer: one per channel, kept between threads | New. Pieces exist: sandboxes are already keyed to a scope (`tasks-v2.md`), and the browser with live view and take-over is built for code sessions. `agent-browser.md` planned a hosted browser per session; this replaces that with the agent's computer |
| The agent starting and steering sessions from a thread: `start_session`, a message into a session, a wake when it finishes | New. The centre of this section |
| A result card from a session into its thread: clip, preview link, size of the change, pull request | New |
| What the channel has open, given to every agent turn | New |
| Lor opening pull requests behind approval | New. Needs the Lor bot identity in `code-sessions-runbook.md` chunk 4 |
| Slack as a surface: read and post in linked channels' threads, match Slack people to Lor members, approval buttons | New. Reverses a locked decision (§11) |
| Webhooks with Slack and Discord payloads, per channel | Built (`automation-primitives.md` §3) |
| A webhook's card as the start of a thread on the agent's page | Changed. It posts into the channel chat today |
| Passing a webhook's card on to the linked Slack channel | New |
| The agent's own repo | New. Code sessions already checkpoint to a private Git host and rebuild a lost sandbox from it (`code-sessions-runbook.md` chunk 5) |

### The hard parts

- **The agent passing instructions on is a model making a routing call,**
  which `workspace-model.md` rejected for session messages because wrong
  calls cost trust. Two guards: a reply to a result card always goes to that
  session, and the agent always says where it sent an instruction.
- **Two hops are slower and cost more** than talking to a coding agent
  directly. Anyone can still open a session and drive it by hand (rule 9).
- **Who has authority in a Slack thread.** A Slack person who is not matched
  to a Lor member can talk but cannot approve or steer.
- **Who pays.** A session the agent starts runs on Lor's models, as
  unattended runs do today. A person's own Claude Code or ChatGPT plan pays
  only when that person drives a session.
- **How often a status line can update in Slack** has to be checked against
  Slack's limits before the design depends on it.
- **One computer, many threads.** An agent can be in five threads at once and
  has one computer. Each thread gets its own folder and its own browser tab
  there, and anything that needs the whole screen waits its turn.
- **A computer that lasts.** Sandboxes are deleted after 7 days idle today,
  and a lost one comes back empty. The agent's computer has to outlive that,
  and "always on" still means asleep until there is work, not running all
  day (`beta-pricing-runbook.md`).
- **The team's logins on a machine an agent drives.** A person signs it in
  through the live view, never through the chat. Anything it sends, buys,
  publishes or deletes goes through approval, and pages it reads can try to
  instruct it. This is the most sensitive piece in the design.

### Limits at first

A session cannot start sessions, and a thread has a cap on sessions running
at once. A person can still start a session and drive it by hand, as now. Spend stays the only run limit. There is still no standing session
per agent: its state between wakes is its memory, its Log and the list of
what its channel has open.

### Handoff between channels

`handoff` (new) sends a request to another channel's agent.

- It starts a thread in the target channel, which that agent handles under
  its own brief, tools and approvals. The result returns to the asking thread
  as a message with a link.
- Both threads are visible. There is no standing room where agents chat among
  themselves.
- Only the text of the request and the result cross. Neither agent gets the
  other's tools or memory.
- Allowed only between channels linked in Setup ("#support may hand off to
  #eng"), set by someone who can see both, as a change proposal.

### What this overrides

| Earlier in this doc | Now |
|---|---|
| §4: the agent's page is your own chat with it, and a card is a session | The channel's page is its threads, shared. A private chat with the agent is rule 12. A thread shows result cards; a session is one level below |
| §4: the panel beside the chat is the session | The panel is the thread. A session opens from a result card |
| §7: Slack gets notifications and links, never a conversation | Threads live in Slack with the conversation. Opening a session's computer stays in Lor |
| §3.4: Lor in a general chat failed | Lor in a thread works, because the thread contains it. It never replies at the top level |
| §4: the agent has no computer of its own | It has one, general purpose and kept between threads. Sessions have dev boxes |
| §5 earlier the same day: the thread is a session | The thread is the chat with the agent. A session is only the coding agent |
| §6: a new kind of work is a session mode | A session is a coding agent. Chat sessions become threads. A document or a canvas is something the agent and people work on beside the thread |
| §3.4: general chat leaves the default product, with Team chat as a workspace setting | Team chat is hidden for now (Jacob). It is a room attached to the agent: empty, a linked Slack or Discord channel, or later Lor's own chat as a tab ("The room") |
| §5 earlier the same day: the channel is a chat, with people and the agent in one timeline | The channel's page is the agent's threads. The chat is a room beside it |
| §5: the agent does not change a repository on its own computer | It has its own repo for its tools and scripts. It still never changes a product repository there |

## 6. Kinds of work: chat, code, canvas

**A new kind of work is a session mode, not a channel type.** Code was decided
this way on 2026-10-21. Canvas follows.

- **Modes:** chat and code (built), document (planned,
  `live-collaboration.md`), canvas (new: a shared board where people and Lor
  place, draw and comment).
- **Every mode keeps the session contract:** multiplayer, Lor takes turns in
  it, its own computer, history, fork, subscriptions, needs you.
- **A person picks the mode,** at the start or with "Continue in…", as
  Continue in Code works now. Lor may suggest a mode. It never switches by
  itself: a model routing people's work was rejected in `workspace-model.md`
  because wrong calls cost trust.
- **A "canvas channel" is a channel with a pinned canvas.** A channel can pin
  sessions as tabs beside the chat. A design channel pins
  its board and opens there. `channel_type` keeps describing transport (text,
  voice, DM, category) and gets no canvas value.
- **Pins are where V2 lands.** A generated app (`product-direction.md` V2) is
  another pinned surface. The first step is **pinned numbers**: a few
  live figures from the channel's connectors (MRR, signups, open errors) that
  the agent refreshes on a Loop.
- **Voice** stays as built: a channel type, hidden by flag. Folding it into a
  channel as a surface is not part of this plan.
- **Technology:** canvas sync on Yjs, on the same server as documents. The
  canvas library is not chosen. Check licences first, as
  `live-collaboration.md` requires.

## 7. Bring your own agent

**Bring any agent as a worker or as a client. No outside agent owns a
channel.**

| Way | Example | Stance | Why |
|---|---|---|---|
| Worker in a session | Claude Code, Codex. Next: OpenCode and ACP agents | Yes. Built for two | It runs in the session's sandbox under Lor's session, approvals and history. The person's own plan pays (`harness-sessions.md` §3) |
| Remote agent as a tool | A vendor's agent with an API or MCP endpoint | Yes, with a team-owned credential | Connected once for the workspace, like an MCP server. Calls are logged and can need approval. The result lands in the session |
| Personal agent as a client | Someone's Grok Bot or Dot reads team context and starts sessions | Yes, later, through a Lor MCP server | It signs in as its owner and gets that person's permissions. What it starts is a normal session the team sees |
| Personal agent as a channel's agent or member | "Add my Grok Bot to #eng" | No | Below |

Why a personal agent never owns a channel:

- **It leaves with the person.** The agent, its memory and its logins belong
  to one account.
- **Its memory and computer sit with the vendor.** The team cannot read,
  search or cite them.
- **Nobody else can see its work or approve it.** Lor's approvals cannot gate
  what it does on its own computer.
- **There is no way to host one today.** Coverage of Grok Bot names only its
  own desktop and iPhone apps. Dots are reached through ChatGPT, Slack and
  Teams.

For sales: "Bring your agent to the work. The team's agent, and what it
learns, stay with the team."

**Lor MCP server** (not built; `apps/api` exposes none). Per-person OAuth, the
person's permissions, a few tools: search team context, start a session, read
a session, list what needs you.

### Slack and Discord: a second place for threads

Revised 2026-11-17. The earlier stance here was "an integration, not a bot":
notifications and links only, never a conversation. §5 replaces it. The team
that builds Grok Bot works with it in Slack threads, and Dots answer in Slack
and Teams, so staying out of the thread means staying out of where the work
happens.

- A Slack channel can be linked to a Lor channel. The channel's agent is
  present in both, and a thread started in either is the same thread (§5,
  "Where the chat lives").
- What stays in Lor: the agent's memory, setup, search, and opening a
  session's computer.
- What keeps this from being a Slack bot: the same threads work in Lor with
  no Slack at all, and the work behind them is Lor's.
- Reading the rest of Slack as context is still `slack-connector-next.md`.

This reverses the "hard boundary" in `slack-connector-next.md` (§11).

## 8. Context and memory in one place

What the workspace holds (built unless marked):

- **Memory pages,** workspace-wide and per channel, with versions and
  supersedes links.
- **Connected tools:** GitHub, Linear and Attio indexed as text; others read
  live.
- **The team's own history:** sessions, chat, voice calls, shared files.
- **Rules:** answers cite their source, access follows each item's audience,
  and nothing lives in a personal account.

Gaps:

- **Slack reading** (`slack-connector-next.md`, not started). With Team chat
  off, this is the only way the team's conversation becomes context, so it is
  what makes "one place" true.
- **The agent's standing notes.** One page per channel that the agent keeps
  current: what it watches, known issues, open questions. A convention on the
  existing channel memory, written into the brief.

## 9. Built, changed, new

| Piece | State |
|---|---|
| Sessions, code sessions, sandbox, browser, fork and rewind | Built |
| Loops, connector triggers, webhooks, Act session modes | Built |
| Tool profiles per channel, approval policies, change proposals | Built |
| Channel and workspace memory, source index | Built |
| Claude Code and Codex as workers | Built |
| Cross-channel session list in the sidebar | In review (PR #239) |
| Channel page: the agent's chat with cards, and a panel beside it for the work, Setup and the Log | Change |
| Sidebar: channel rows with agent state, sessions not nested | Change |
| Team chat becomes a workspace setting, off by default | Change |
| Lor opens a draft pull request behind approval | Change to a locked decision |
| Channel brief | New |
| Triage (Pass and Note) without a sandbox | New |
| `start_session`, child sessions, wake on child done | New |
| Handoff between linked channels | New |
| Slack notifications and digest | New |
| Saved prompts | New |
| Slack reading | New, designed |
| Pinned numbers, pinned surfaces, canvas mode | New, later |
| Starting a session from Slack | New, later |
| Lor MCP server for personal agents | New, later |

## 10. Build order

Each phase ends with a check at Jacob's company. The bar is his: "we don't
know how we would move as fast without this."

| Phase | Work | Check |
|---|---|---|
| 0. Run one job | The dev agent on what exists: error alert, Act in code mode, a fix on a branch. Clear the owed live QA on that path. No new product | Fixes reach a person within the hour, and someone merges one |
| 1. The channel is an agent | Brief, the agent chat with cards and its panel, Setup, the Log, the roster, For you (PR #239), Team chat off by default, Slack notifications and digest | A teammate who was not told how can say what the #eng agent is watching and what it did yesterday. Approvals are answered from Slack links |
| 2. Finish and delegate | Draft pull request behind approval, triage, `start_session`, handoff | Merged fixes per week. People other than Jacob approve |
| 3. Context | Slack reading, saved prompts | The agent answers "why" questions with Slack citations |
| 4. Surfaces | Pinned numbers, pins, canvas mode, starting from Slack, Lor MCP server | A second kind of team (support or GTM) sets up a channel without help |

Phases 1 and 2 hold most of the product change. Phase 1 is mostly interface
over existing data, plus one new table for the brief and the Slack
notifications.

## 11. Locked docs this would change

| Doc | Now | Becomes |
|---|---|---|
| `workspace-model.md` item 4 | A channel is a shared project plus a team chat | A channel is an agent, its setup and its sessions. Team chat is a workspace setting, off by default |
| `workspace-model.md` items 1 and 7 | Lor never posts in channel chat. `@Lor` there starts a session and posts nothing | The channel page is the agent's chat. Lor posts results and asks there, and each piece of work is a card with its own thread |
| `workspace-model.md` item 16 | The channel page is the chat. Sessions list is a right-panel view | The channel page is the agent's chat. A people-only Chat tab only when Team chat is on |
| `workspace-model.md` item 12 | Sessions listed under their channel, and no inbox view | A Sessions tab (yours, across agents, by Needs you, Running, Recent) and an Agents tab |
| `workspace-model.md` pass, decision 2 | Connector and webhook posts stay in chat | Their home is the Log. They also show in Chat when it is on |
| `onboarding.md` | The startup template creates chat channels | The template creates channels with an agent set up. Chat only when Team chat is on |
| `code-channels.md`, 2026-10-22 | Lor never commits or opens pull requests | Lor opens a draft pull request behind approval in agent-started sessions |
| `positioning.md` | "The multiplayer runtime for your agents" | The thesis in §1 |
| `slack-connector-next.md` | No posts into Slack of any kind, and never a Slack bot | Threads with the agent live in linked Slack channels: it reads and posts in those threads. Reading the rest of Slack stays as designed there |
| `workspace-model.md` items 2 and 3 | A session has its own computer and sits next to the chat, not inside it | A thread is the conversation and sits under a channel message. The agent has its own computer, and each session it runs has a dev box |

Unchanged: Lor never writes in the people-only Team chat, one session per
piece of work, anyone who can see a session can type in it, every session
visible to its channel, subscriptions, archive, and the rejection of
model-routed sessions.

## 12. Decisions for Jacob

| # | Decision | Recommendation |
|---|---|---|
| 1 | Thesis wording | "Always-on agents for your team. Your context and memory in one place." Lead with the team, back it with ownership (§1) |
| 2 | One agent per channel, called Lor | Yes. Renaming per channel later |
| 3 | General chat (revised a third time 2026-11-17) | Hidden for now (Jacob). It is a room attached to the agent: a linked Slack or Discord channel now, Lor's own chat as a tab later (§5, "The room") |
| 4 | Lor opens draft pull requests behind approval | Yes, for agent-started sessions only |
| 5 | Slack and Discord (revised again 2026-11-17) | Threads with the agent live in linked Slack channels as well as in Lor (§5). I argued against this twice; the interview changed my mind |
| 6 | Canvas | A session mode with pinned tabs, not a channel type |
| 7 | Personal agents | Worker or client. Never a channel's agent |
| 8 | First job for the check | The dev agent. It is the closest to built |
| 9 | The word "channel" (revised 2026-11-17) | With chat off by default, "channel" and "#" say the wrong thing. Settle it in phase 1's design: drop the "#" and try "agent" as the word in the interface. Keep `channel` in code |
| 10 | The agent's page (revised 2026-11-17) | Your chat with the agent, with work as cards and a panel beside it (§4). The event log sits behind the header. No room where agents chat among themselves |
| 11 | Who sees what (revised 2026-11-17) | Threads are open to the channel, as in Slack. A private chat with an agent is for questions, and work that starts there opens a thread (§5 rule 12) |
| 14 | The thread and the session are two things (added 2026-11-17) | Yes. People talk in the thread; the agent runs sessions behind it and brings back proof (§5) |
| 16 | The agent has its own computer (Jacob, 2026-11-17) | Yes: general purpose, one per agent, kept between threads. It never changes a repository there |
| 17 | What "session" means (Jacob, 2026-11-17, confirmed 2026-11-18) | Only the coding agent with its dev box. The conversation with the agent is a thread, with its own shape: no repo, mode or coding agent of its own. I blurred this in the seventh revision and Jacob corrected it |
| 18 | Chat or threads in a channel (revised 2026-11-17) | The channel's page is the agent's threads. Chat is a room beside it (decision 3). My earlier answer, one timeline for both, is withdrawn |
| 19 | Not only code (Jacob, 2026-11-17) | Decided. Every channel's agent is a general orchestrator for its area. Coding agents are how it does the work and builds its own tools |
| 20 | The agent's own repo (Jacob, 2026-11-17) | Yes: its tools, scripts and packages, in Git, so its computer can be rebuilt. Product repositories still change only in sessions |
| 21 | Where events go with the chat hidden (added 2026-11-17) | To the agent's page as the start of a thread, and passed on to the linked Slack channel. Webhooks stay Lor's own (§5, "Events arrive at the agent") |
| 23 | The sidebar (Jacob, 2026-11-18) | Two tabs: Work (yours, by Needs you, Running, Recent) and Agents. Replaces `workspace-model.md` item 12 |
| 24 | The main chat with an agent (2026-11-18) | A box on the agent's page that starts a thread. Many threads per agent, not one long chat |
| 25 | New session (Jacob, 2026-11-18) | Stays as it is: a person starts one coding agent in one repo, with no agent above it |
| 28 | Sessions are tools to the agent (Jacob, 2026-11-18) | Yes: start, message, read, stop, hand over. A thread spans repos by having several sessions, so a session itself stays one repo |
| 29 | What the room is for (2026-11-18) | The agent's ears, its voice to the team and a door to it. A thread is the same thing whether it starts in the room or on the agent's page |
| 30 | How the agent reaches out (2026-11-18) | It starts a thread: to the room when the team should see it, to one named person when one person has to act, or on its own page when it handled it. Three reasons only, one thread per subject, quiet hours and a daily cap (§5) |
| 26 | The agent in the room (Jacob, 2026-11-18) | It listens from the start and answers when mentioned. Speaking up unasked comes later, as a setting per room, always in a thread |
| 27 | One room per agent at a time (2026-11-18) | Yes. No copying of people's messages between Slack and Lor |
| 22 | Whose plan pays for a session nobody asked for (open, 2026-11-17) | The subscription of the watch's owner if they allow it, otherwise workspace credits. Check each provider's terms for runs with no person present before building it |
| 15 | The agent replies only in threads (added 2026-11-17) | Yes. It posts at the top of a channel only to start a thread for work it began itself |
| 12 | An owner per session and per watch (added 2026-11-17) | Yes. Everyone can still write in a session; the owner settles it |
| 13 | Trust levels per watch (added 2026-11-17) | Yes: observes, prepares, acts, owns. Start every watch at observes or prepares |

## Sources

Press coverage, read 2026-11-16. OpenAI's own page returned an error.

- Grok Bot: [DataCamp](https://www.datacamp.com/blog/grok-bot),
  [Toolradar](https://toolradar.com/blog/what-is-grok-bot),
  [grok-bots.com](https://grok-bots.com/) (unofficial; Team Bots claim)
- Dots: [VentureBeat](https://venturebeat.com/technology/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams),
  [9to5Google](https://9to5google.com/2026/09/29/openai-dots-agent/),
  [OpenAI](https://openai.com/index/introducing-dots/) (not read)
- The interview (YC Lightcone, "The Rise Of AI Coworkers", 2026-11-14), from
  write-ups, not the transcript:
  [BigGo](https://finance.biggo.com/podcast/e075716ae1e521f9),
  [newsfilter](https://newsfilter.io/interviews/the-rise-of-ai-coworkers-3f5fea27d6505e63a509511d7066be99),
  [João Queirós](https://www.ai.joaoqueiros.com/blog/lauren-tan-roman-ugarte-rise-ai-coworkers-lightcone)
- Interface: [xAI, Designing Grok Bot](https://x.ai/news/designing-grok-bot)
  (read). Dots: [Flavio Copes](https://flaviocopes.com/openai-dots/) and
  [Prompt Advisers](https://www.promptadvisers.com/openai-dots-review) (search
  summaries only, pages not opened)
- Muse: [Wikipedia](https://en.wikipedia.org/wiki/Muse_(AI_agent)),
  [Tech Insider](https://tech-insider.org/what-meta-actually-shipped-with-muse/)
