# Agent harness: next priorities after Pi

These are the immediate follow-ups once the basic Pi investigation harness is shipped.

## Agent-owned persistent instructions (`LOR.md`)

Give each workspace an agent-owned instruction file that is injected at the beginning of every conversation, below higher-priority policy and without the ability to override it.

- Keep it distinct from workspace memory: memory stores company knowledge; `LOR.md` stores durable operating instructions, preferences, and lessons about how the agent should work.
- Treat it as a canonical Lor workspace asset, not a repository file to discover. A repository file named `LOR.md`, `AGENTS.md`, `AGENT.md`, or `CLAUDE.md` must never be injected as workspace instructions or loaded outside the coding harness and its directory scope.
- Resolve conflicts deterministically from highest to lowest priority: system policy, product/developer policy, scoped repository instructions during code work, current authorized thread instructions, then approved workspace instructions. Workspace memory is reference data, never an instruction layer; within one layer, the narrower scope wins.
- Let the agent propose updates when it learns an important reusable behavior, but keep each proposed version inactive until a human explicitly approves that exact change.
- Keep an immutable audit record for every version with the proposing actor, approving actor, version, timestamps, and approval state; make changes shared, visible, reviewable, and reversible.
- Reject secrets, credentials, PII, invalid versions, and unresolved conflicts during both writes and conversation-start injection. Revalidate before injection and fail closed.
- Let humans inspect and edit it directly without allowing the agent to approve its own changes.
- Use `LOR.md` as the product-owned name while keeping repository instruction-file conventions separate.

## Generous agent runtime budgets

Remove small normal-operation caps so the harness can complete longer, more agentic work.

- Prefer compaction and cost-aware continuation over routinely stopping healthy runs.
- Retain hard application ceilings for request and context tokens, tool-output size, total model/tool turns, wall-clock time, retries, and spend.
- Enforce these budgets independently of model context limits so runaway tool loops and provider costs are always bounded.
- Track every budget cumulatively across the entire run and persist the counters through compaction, pauses, retries, and continuation; resuming must reuse rather than reset them.
- Persist the exact stop reason and completion or compaction state before continuation is offered. Once any hard budget is exhausted, the same run cannot continue.
- Treat these as safety rails rather than normal stopping targets.

## Realtime multiplayer steering and queuing

Allow people to send instructions while the agent is already working in a thread.

- A new message can either steer the active run immediately or queue work for after the current run.
- Preserve author attribution, ordering, and a durable event history when several people steer simultaneously.
- Before acknowledging or queuing, atomically verify workspace membership for public Merlin threads, the sender's access to the target thread, the thread and run's workspace ownership, and the sender's permission to act on that run. Author attribution is audit data, not authorization.
- Give every message an idempotency key and server-side sequence number. Revalidate and atomically transition the active run with the authorization checks; if its state changed after the client read it, queue the message instead so ordering and replay safety are preserved.
- Show clear run state in the thread: working, steering available, message queued, applying new direction, stopped, or complete.
- Design the composer so steering versus queuing is explicit without making an ordinary chat thread feel like a specialist agent console.
- Never silently drop a message; ambiguous or late steering should safely become queued work.

## Suggested order

1. Raise and instrument runtime budgets.
2. Add the workspace `LOR.md` lifecycle and context injection.
3. Build realtime steering and queued follow-ups on top of explicit run state.

Together these move Merlin from a bounded request/response assistant toward a persistent, configurable multiplayer agent without prematurely introducing autonomous code-writing permissions.

The next milestone after this harness work is the one-way, read-only [`Slack connector`](./slack-connector-next.md).
