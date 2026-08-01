# Slack connector: read Slack from Townhall, never become a Slack bot

This is the next product milestone after the priorities in [`agent-harness-next.md`](./agent-harness-next.md).

## Product goal

Let people query their company's authorized Slack history from inside Townhall.

- Search Slack messages, threads, channels, people, links, and accessible files.
- Fetch full thread context when a search result is relevant.
- Use Slack as grounded source material for Merlin's answers and workspace memory.
- Treat the querying Townhall user as the authorization principal, constrained by the installation's Slack scopes and the source's current access controls.
- Clearly identify and link back to Slack as the source.

## The hard boundary

Information can flow from Slack into Townhall's context, but the Townhall agent does not operate inside Slack.

Townhall will not:

- expose Merlin through Slack mentions, DMs, slash commands, or shortcuts;
- answer questions about Townhall from inside Slack;
- post agent responses, messages, reactions, summaries, or notifications into Slack;
- turn Slack channels into a second interface for Townhall;
- request write scopes merely to make the integration feel more bot-like.

Slack event subscriptions or webhooks may be used privately to keep authorized data synchronized. Before processing, verify Slack's signature and timestamp freshness, reject replayed event IDs, bind the event to its installing workspace, and re-check source authorization before indexing. They are ingestion infrastructure, not a conversational or action surface, and they must never cause Townhall to reply in Slack.

## Product posture

The connector is a read-only knowledge bridge:

```text
Slack data → Townhall search, grounding, and memory
Townhall agent/actions ✕→ Slack
```

This keeps Townhall as the primary multiplayer AI workspace instead of reducing it to another Slack bot. Slack is an important source of company context; it is not where users operate Merlin.

## MVP definition

- Connect a Slack workspace with the minimum read-only permissions required.
- Query only content the requesting Townhall user is currently authorized to access in Slack; installation-level access alone is insufficient.
- Search first, then fetch complete messages and thread context on demand.
- Return grounded results with author, channel, timestamp, and a Slack permalink.
- Store source ACL metadata with every indexed record and enforce the same authorization checks during search, thread expansion, and file retrieval.
- Block stale records when scopes, channel membership, or source content changes until deletion or re-sync completes.
- Provide disconnect, token revocation, deletion, and re-sync controls.
- Ship no Slack-side conversational UI and no Slack write actions.

## Non-goals

- Replacing Slack
- Mirroring Townhall conversations into Slack
- Cross-posting between the products
- Running Merlin as a Slack bot
- Letting Slack users query Townhall memory, artifacts, agents, or generated apps
- Taking actions in Slack on a user's behalf

Future Slack capabilities should be rejected if they weaken this one-way boundary, unless the product strategy is explicitly reconsidered.
