# Harness accounts and autonomous billing

Implemented 2026-11-22. Requires the schema update before deployment.

## Settings

- **Settings → Linked accounts** connects multiple named Claude Code and Codex
  accounts. Personal accounts belong to the person across their workspaces.
- **Workspace settings → AI accounts → Your defaults** selects a personal
  default and automatic fallback for each provider in that workspace. Every
  member can manage their own choices.
- **Autonomous runs** requires `billing:manage`. It selects the default agent
  for channel work and new autonomous sessions, the Lor API model and payer,
  and separate Claude Code/Codex billing choices. API billing defaults to Lor
  credits; workspace API keys are configured in Billing.
- Dedicated Lor accounts belong to one workspace. Linking one does not enable
  it: an admin explicitly selects subscription billing. Provider terms still
  apply; a dedicated subscription does not establish permission to automate it.

## Routing

A person's direct Claude Code or Codex session turn uses that person's selected
account. Automated Loop fires, connector events, agent-created session turns,
channel agents, compaction and post-answer memory work use workspace policy.
An agent-created session's creator is attribution, never a funding fallback.
A direct human message in such a session uses its sender's own account.

Existing sessions retain their harness and native conversation. New autonomous
sessions use the workspace's current default harness. Account and API billing
preferences apply to each new turn of the corresponding harness.

Account selection is stored in `agent_run.harness_account` before prompt
construction. Full run context also records it. API funding pins its source,
model and API key identity separately. Recovery and approval continuations keep
the original payer; a removed API key or disconnected pinned account stops the
turn. Approval decisions do not make the approver the payer.

Only provider usage/quota errors rotate subscriptions. The configured default
is first, followed by accounts of the same provider and owner in connection
order. An exhausted account is unavailable until the provider's reset time,
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
workspace billing rules. Post-answer work resolves its own workspace funding
instead of borrowing the sender's subscription.

## Rollout and verification

Apply `pnpm db:push` against the deployment database before releasing API,
workers, realtime and clients together; restart workers so old routing does not
remain in flight. The schema adds workspace account ownership, account labels
and availability, preferences, workspace policy and the run's pinned route.
It replaces the one-account-per-provider index while retaining GitHub's
single-account constraint and existing personal account rows.

Verification uses lint, serial type checking and a manual browser review with
sample accounts in an isolated local database. Real account linking, provider
quota exhaustion and native API billing require live provider verification.
The shared database has not been migrated from this session.
