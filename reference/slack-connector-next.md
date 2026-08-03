# Slack connector: read Slack from Lor, never become a Slack bot

This is the next product milestone after the durable agent harness ([`agent-harness.md`](./agent-harness.md), shipped).

## Product goal

Let people query their company's authorized Slack history from inside Lor.

- Search Slack messages, threads, channels, people, links, and accessible files.
- Fetch full thread context when a search result is relevant.
- Use Slack as grounded source material for Merlin's answers and workspace memory.
- Map the querying Lor user to a verified member of the connected Slack workspace and use that identity as the authorization principal.
- Check current Slack permissions for every request. Installation scopes and stored ACL metadata are constraints, not proof of access; deny when identity mapping or current authorization state is unavailable.
- Clearly identify and link back to Slack as the source.

## The hard boundary

Information can flow from Slack into Lor's context, but the Lor agent does not operate inside Slack.

Lor will not:

- expose Merlin through Slack mentions, DMs, slash commands, or shortcuts;
- answer questions about Lor from inside Slack;
- post agent responses, messages, reactions, summaries, or notifications into Slack;
- turn Slack channels into a second interface for Lor;
- request write scopes merely to make the integration feel more bot-like.

Slack event subscriptions or webhooks may be used privately to keep authorized data synchronized. Process them in order: verify Slack's signature and timestamp freshness, bind the event to its installation, deduplicate its `event_id`, apply resource-specific timestamp or version ordering when available, and re-check source authorization before indexing. Never discard an event solely because it is older than an unrelated workspace event. If delivery is disabled, stale, or has a detected gap, run bounded reconciliation and quarantine affected records and derivatives until freshness is restored. This is ingestion infrastructure, not a conversational or action surface, and it must never cause Lor to reply in Slack.

## Product posture

The connector is a read-only knowledge bridge:

```text
Slack data → Lor search, grounding, and memory
Lor agent/actions ✕→ Slack
```

This keeps Lor as the primary multiplayer AI workspace instead of reducing it to another Slack bot. Slack is an important source of company context; it is not where users operate Merlin.

## MVP definition

- Connect a Slack workspace with the minimum read-only permissions required.
- Query only content the requesting Lor user is currently authorized to access in Slack; installation-level access alone is insufficient.
- Search first, then fetch complete messages and thread context on demand.
- Return grounded results with author, channel, timestamp, and a Slack permalink.
- Store source ACL metadata and lineage with every indexed record and every derivative, including summaries, embeddings, caches, workspace-memory pages, and stored-summary fallbacks.
- Enforce current authorization during search, grounding, thread expansion, and file retrieval. When scopes, membership, source content, or deletion state changes, immediately quarantine the source and every derivative until deletion or re-sync completes.
- Provide disconnect, token revocation, deletion, and re-sync controls.
- Ship no Slack-side conversational UI and no Slack write actions.

## Non-goals

- Replacing Slack
- Mirroring Lor conversations into Slack
- Cross-posting between the products
- Running Merlin as a Slack bot
- Letting Slack users query Lor memory, artifacts, agents, or generated apps
- Taking actions in Slack on a user's behalf

Future Slack capabilities should be rejected if they weaken this one-way boundary, unless the product strategy is explicitly reconsidered.
