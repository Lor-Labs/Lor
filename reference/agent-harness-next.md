# Agent harness: next priorities after Pi

These are the immediate follow-ups once the basic Pi investigation harness is shipped.

## Agent-owned persistent instructions (`AGENT.md`)

Give each workspace an agent-owned instruction file that is injected at the beginning of every conversation, below system policy and without the ability to override it.

- Keep it distinct from workspace memory: memory stores company knowledge; `AGENT.md` stores durable operating instructions, preferences, and lessons about how the agent should work.
- Let the agent propose updates when it learns an important reusable behavior, but keep each proposed version inactive until a human explicitly approves that exact change.
- Keep an immutable audit record for every version with the proposing actor, approving actor, version, timestamps, and approval state; make changes shared, visible, reviewable, and reversible.
- Reject secrets, credentials, and PII during both writes and conversation-start injection. Revalidate every injected version and always give system policy precedence.
- Let humans inspect and edit it directly without allowing the agent to approve its own changes.
- Keep the name provisional so it does not accidentally conflict with repository-level `AGENTS.md` conventions.

## Generous agent runtime budgets

Remove small normal-operation caps so the harness can complete longer, more agentic work.

- Prefer compaction and cost-aware continuation over routinely stopping healthy runs.
- Retain hard application ceilings for request and context tokens, tool-output size, total model/tool turns, wall-clock time, retries, and spend.
- Enforce these budgets independently of model context limits so runaway tool loops and provider costs are always bounded.
- Persist the exact stop reason before a run can be continued, and explain whether it completed, compacted, exhausted a budget, or was stopped.
- Treat these as safety rails rather than normal stopping targets.

## Realtime multiplayer steering and queuing

Allow people to send instructions while the agent is already working in a thread.

- A new message can either steer the active run immediately or queue work for after the current run.
- Preserve author attribution, ordering, and a durable event history when several people steer simultaneously.
- Give every message an idempotency key and server-side sequence number. Revalidate and atomically transition the active run before acknowledging a steer; if its state changed after the client read it, queue the message instead so ordering and replay safety are preserved.
- Show clear run state in the thread: working, steering available, message queued, applying new direction, stopped, or complete.
- Design the composer so steering versus queuing is explicit without making an ordinary chat thread feel like a specialist agent console.
- Never silently drop a message; ambiguous or late steering should safely become queued work.

## Suggested order

1. Raise and instrument runtime budgets.
2. Add the workspace `AGENT.md` lifecycle and context injection.
3. Build realtime steering and queued follow-ups on top of explicit run state.

Together these move Merlin from a bounded request/response assistant toward a persistent, configurable multiplayer agent without prematurely introducing autonomous code-writing permissions.

The next milestone after this harness work is the one-way, read-only [`Slack connector`](./slack-connector-next.md).
