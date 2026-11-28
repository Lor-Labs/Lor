# Harness accounts and autonomous billing

Implemented 2026-11-22. Requires the schema update before deployment.

Changed 2026-11-24 (`agents-and-chats.md`, decisions 7 and 16): the
autonomous settings are each agent's own (`agent_harness_settings`), edited in
the agent's dialog under Runs. The workspace's Autonomous runs section and
`workspace_harness_settings` are gone, and a person with no plan of their own
now falls to the agent's settings.

Changed 2026-11-27 (`agents-and-chats.md`, decision 54): subscriptions pay
only for coding sessions. An agent's own turns, memory pass and write-back
run on its model (Lor credits or a provider key); a person's plan no longer
pays for the agent's turns they ask for, only for coding sessions they ask
for. The agent's Runs tab sets what the coding sessions it starts with
nobody asking run on, and their default; the agent can pick another coding
agent, model and the other session settings per session. Where this doc
says a direct channel request or channel inference uses a subscription, read
"a coding session". Runs that pinned a subscription before keep it to finish.

Changed 2026-11-28: one resolver picks every new code session's harness and
payer, and a new code session never runs on Pi (see "Code session payer").

## Code session payer

`resolveCodeSessionPayer` (`packages/lor/src/code-session-payer.ts`) decides
the harness and payer of each new code session and of an agent's follow-ups
in one, in this order:

1. **The requester's own plan.** For a direct request only: the person's
   preferred agent (Settings → Linked accounts), then the other coding agent,
   using the first one they linked an account for, in their account order and
   fallback. A personal preference of "Lor · API billing" (`pi`) or no linked
   account moves on. A plan at its usage limit refuses; the work never moves
   to another plan or payer.
2. **The agent's Runs policy.** Its subscription accounts when an admin chose
   subscription billing, else the workspace's provider API key when the agent
   bills that coding agent to it and the key exists.
3. **Lor credits.** The real Claude Code or Codex harness with inference
   through the AI Gateway (`apiBilling: "lor"`), when `checkCredits` allows.
4. **Refusal.** An error that says what to set up (Linked accounts, the
   agent's Runs, AI providers or credits). `start_session` returns it for the
   agent to pass on verbatim.

Loops, connector events, check-ins and Act sessions have no requester and start
at step 2. A Discord place is personal only: step 1 or a refusal.
`start_session` without a repo lists each coding agent with who would pay, marks
the one the resolver would pick as the default, and returns `unavailable` when
nothing can pay. Its `runsOn` names the harness and payer it started on.

Pi is not a code-session harness (decision 34): `CODE_SESSION_HARNESSES` in
`packages/utils/src/features.ts`. `createSession` refuses a new code session on
any other harness (forks keep their source's). Realtime's `codeStartFor`
refuses it from clients, and the agent Runs API no longer accepts `pi` as
a default. A saved `pi` default reads as "no preference". Existing Pi sessions,
chat-mode Act sessions and voice-channel Loop sessions keep running on Pi.

Requester attribution (`channelRequestUserId`): a channel turn's trigger
from a person who mentioned the agent, replied to it, posted top-level, or
whom the inbox classifier read as meant for it (`agent_inbox.inferred`) is the
requester, whether or not they linked a plan. Thread chatter the agent only
overhears, bots and automation are not.

## Settings

- **Settings → Linked accounts** connects multiple named Claude Code and Codex
  accounts. Personal accounts belong to the person across their workspaces.
  A workspace picker selects which workspace's preferences are being edited. Drag each
  provider's accounts into priority order; the first is the default and the
  rest are tried in that order when automatic fallback is on. Keyboard users
  can pick up a handle with Space, move with arrow keys and drop with Space.
  Each member has independent orders, fallback and preferred-agent settings
  in each workspace. Disconnecting an account removes it everywhere.
- The personal preferred agent applies to direct channel requests. Automatic
  selection uses a linked Claude Code account first, then Codex if Claude is
  not linked, and API billing if neither is linked. It does not switch
  providers after a usage limit. Coding sessions retain their own harness.
- **An agent's dialog → Runs** requires `billing:manage` to edit, except the
  model, which takes `channel:update`. It selects what the agent runs on for
  its own turns and the sessions it starts (Lor, Claude Code or Codex), its
  model, and separate Claude Code/Codex billing choices. API billing defaults
  to Lor credits; workspace API keys are configured in AI providers, and a model
  one of them pays for can be the agent's model.
- Accounts connected for agents belong to one workspace, and each agent picks
  its own. Linking one does not enable it: an admin explicitly selects
  subscription billing on an agent. Provider terms still apply; a connected
  subscription does not establish permission to automate it.

## Routing

A person's direct channel requests and Claude Code or Codex session turns use
that person's ordered account pool. A person with no account linked has no
route of their own: the code sessions they ask for go down the resolver above.
Code-session tasks started during a direct channel request pin the resolved
route before enqueueing. Automated Loop
fires, connector events, background channel wake-ups, compaction and post-answer
memory work use the settings of the agent in the channel (`channelAgentId`;
a channel with no agent, like a voice channel, gets the defaults: Lor's own
agent on Lor credits). An agent-created session's creator is
attribution, never a funding fallback; only the explicit direct-request scope
can supply a personal payer. A human message in such a session uses its
sender's own account.

Existing sessions retain their harness and native conversation. New autonomous
sessions use what the agent in their channel runs on. Account and API billing
preferences apply to each new turn of the corresponding harness.

Account selection is stored in `agent_run.harness_account` before prompt
construction. Full run context also records it. API funding pins its source,
model and API key identity separately. Recovery and approval continuations keep
the original payer; a removed API key or disconnected pinned account stops the
turn. Approval decisions do not make the approver the payer.

Only provider usage/quota errors rotate subscriptions, including native CLI
messages such as Claude's "You've hit your 5-hour limit" and Codex's
"You’ve hit your usage limit". The configured default
is first, followed by accounts of the same provider and owner in the person's
saved workspace order. Newly linked accounts are appended; deleted account IDs
are ignored. Dedicated autonomous accounts retain connection order after their
selected default. An exhausted account is unavailable until the provider's reset time,
or five minutes when no reset is supplied. Disabled fallback tries only the
selected account. Exhausting the pool stops inference without changing provider
or billing source.

Native session failover saves the interrupted conversation and resumes its
completed work. If tools ran and no native state can be saved, the turn fails.
`harnessPartial` prevents recovery from delivering an interrupted response as
a completed answer. Channel inference only proposes tool calls; Lor retains
execution, approvals and durable results across account changes. Its short-lived
native harness sandbox is named `run-<run id>` and deleted after inference.

Subscriptions do not incur API inference charges. API keys retain Lor's existing
platform-fee billing; sandbox and other service usage retain their existing
workspace billing rules. Post-answer work resolves its own funding from the
agent's settings instead of borrowing the sender's subscription.

## Rollout and verification

Apply `pnpm db:push` against the deployment database before releasing API,
workers, realtime and clients together; restart workers so old routing does not
remain in flight. The schema adds workspace account ownership, account labels
and availability, preferences, workspace policy and the run's pinned route.
It also adds the personal preferred-agent table and per-provider account order.
It replaces the one-account-per-provider index while retaining GitHub's
single-account constraint and existing personal account rows.

Verification uses lint, serial type checking and a manual browser review with
sample accounts in an isolated local database, including drag ordering,
keyboard ordering, saved preferences and workspace isolation. Real account linking, provider
quota exhaustion and native API billing require live provider verification.
The shared database has not been migrated from this session.
