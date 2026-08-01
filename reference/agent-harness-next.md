# Agent harness: next priorities after Pi

These are the immediate follow-ups once the basic Pi investigation harness is shipped.

## Agent-owned persistent instructions (`AGENT.md`)

Give each workspace an agent-owned instruction file that is injected at the beginning of every conversation.

- Keep it distinct from workspace memory: memory stores company knowledge; `AGENT.md` stores durable operating instructions, preferences, and lessons about how the agent should work.
- Allow the agent to update it when it learns an important reusable behavior.
- Make changes shared, visible, versioned, attributable, reviewable, and reversible.
- Let humans inspect and edit it, and never store credentials or other secrets in it.
- Keep the name provisional so it does not accidentally conflict with repository-level `AGENTS.md` conventions.

## Generous agent runtime budgets

Remove the current arbitrary input-token cap and low turn limit so the harness can complete longer, more agentic work.

- Prefer model context limits, compaction, and cost-aware continuation over small fixed caps.
- Retain high emergency ceilings for wall-clock time, total model/tool turns, spend, repeated failures, and runaway loops.
- Make limits observable so a run explains whether it completed, compacted, exhausted a budget, or was stopped.
- Treat these as safety rails rather than normal stopping targets.

## Realtime multiplayer steering and queuing

Allow people to send instructions while the agent is already working in a thread.

- A new message can either steer the active run immediately or queue work for after the current run.
- Preserve author attribution, ordering, and a durable event history when several people steer simultaneously.
- Show clear run state in the thread: working, steering available, message queued, applying new direction, stopped, or complete.
- Design the composer so steering versus queuing is explicit without making an ordinary chat thread feel like a specialist agent console.
- Never silently drop a message; ambiguous or late steering should safely become queued work.

## Suggested order

1. Raise and instrument runtime budgets.
2. Add the workspace `AGENT.md` lifecycle and context injection.
3. Build realtime steering and queued follow-ups on top of explicit run state.

Together these move Merlin from a bounded request/response assistant toward a persistent, configurable multiplayer agent without prematurely introducing autonomous code-writing permissions.
