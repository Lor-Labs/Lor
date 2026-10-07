# Private questions to Lor

**Status:** Deferred platform decision (2026-09-28). Not scheduled; do not build
until Jacob picks it up.
**Raised by:** [Voice channels](../voice-channels.md). People want to ask Lor
about a session without posting a public question.

## The need

People want to ask Lor about content they can already see (a voice session, a
channel, a thread, a file) without others seeing the question or the answer.
Today every Lor conversation happens in a channel or thread that its audience
can read. There is no private Lor space.

## Why this is a platform question

Lor's retrieval boundary follows the audience of its answer, and today that
audience is always a channel. `resolveLorRunScope`
(`packages/db/src/queries/channel-access.ts`) scopes a run to the channel it
lives in because "everyone who can see the channel sees the answer". A run in a
private channel can search public content plus that one private container.

So a private channel with one member is not a real private Lor space: Lor there
cannot read that person's other private channels or projects.

## Principle to keep

A run may read only what everyone who can see its answer is allowed to see. A
private question has an audience of one, so its boundary can be everything that
person can access, and nothing more.

## Proposed shape

- One private Lor space per person in each workspace. It belongs in the
  workspace UI, not in DMs: DMs have no workspace, Lor runs require one, and DMs
  will be end-to-end encrypted and never indexed.
- Entry points such as "Ask Lor about this session" open the private space with
  the source attached.
- Retrieval uses the person's own access: a user-based run scope next to the
  channel-based one.
- Private questions are kept forever like other data, are searchable only by
  their owner, and never become shared team memory.
- Live voice sessions stay excluded until they end, unless the person is in the
  call.

## Open questions

- Can Lor take actions from the private space, such as creating a Linear ticket,
  or only answer? Actions affect the team, but nobody else would see the request.
  Approval policies would still apply.
- Can private questions write any memory, such as personal notes, or none?
- Can workspace admins see or export private questions?
- When a person loses access to a source, what happens to earlier private
  answers that quoted it?

## Until then

People ask Lor in a session chat or a text channel. Those answers follow normal
channel access and, for live sessions, the live-only rule.
