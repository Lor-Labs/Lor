# Voice channels and shared memory

**Status:** Guiding product spec; not an as-built reference or implementation plan.
**Updated:** 2026-09-24
**Direction:** Build voice channels with conversation memory first. Add live voice interaction with Lor afterward.

## Product goal

Give teams a place to talk and work together where useful context remains
available after the conversation ends. Over time, Lor should be able to join
that collaboration: answer questions, investigate, and carry out requested work
through the team's connected tools.

This advances Lor's broader multiplayer workspace vision. Voice supports daily
communication across engineering, operations, customer work, and planning. Its
value should be apparent even before people can speak commands to Lor.

The first audience is the existing team using Lor for internal communication.
The initial adoption question is whether they choose these voice channels for
real working conversations and find the resulting memory useful afterward.

## Decisions from the product discussion

- Voice channels are the next feature direction to develop.
- The first release focuses on human conversation and memory. Live spoken AI
  responses, wake words, and voice-triggered tasks are a later phase.
- Code channels remain a future direction. Their interaction design is still
  unresolved; they are not a dependency for this feature.
- Direct multiplayer document editing is not a prerequisite for this work.
- Keep the experience within the existing channel structure. Avoid a separate
  meetings dashboard or inbox unless usage demonstrates a concrete need.
- This document guides scope and design. It does not select infrastructure,
  model providers, a database schema, or a public launch date.

## The experience we want

### First release: a conversation the team can return to

1. Teammates join a voice channel to discuss a customer issue and share a screen.
2. Everyone can see whether conversation capture is enabled.
3. They discuss alternatives, agree on a next step, and leave.
4. A durable session record appears in the channel's associated text conversation.
5. A teammate who missed the discussion can read the useful outcome and inspect
   the transcript behind it.
6. Someone asks Lor in text, "What did we decide about this, and why?" Lor can
   retrieve that session and ground its answer in the source conversation.

### Later: Lor helps during the conversation

1. A participant addresses Lor: "What did we decide about this last week?"
2. Lor briefly answers, with sources visible in the channel.
3. Someone asks Lor to investigate the implementation while the team keeps talking.
4. The existing agent system runs the work and posts progress and results in text.
5. Teammates clarify the request, review the result, and approve actions where
   the workspace's existing policies require it.
6. The session preserves the discussion, requested work, and outcomes together.

## Phase 1 — Voice channels with memory

### Everyday voice experience

- Drop-in audio with visible participants and speaking indicators.
- Mute/deafen, input/output device selection, and clear connection state.
- Screen sharing for working through an issue together.
- Stay connected while navigating channels and other Lor surfaces.
- Reliable join, leave, and reconnect behavior.
- An associated text conversation for links, files, and the session record.

The audio experience must stand on its own. A transcription or summarization
failure must not end the call or prevent people from continuing to talk.

### Capture and session records

- Make capture explicitly enabled and visibly active. People joining an active
  session must see its current capture state; provide a clear way to stop it.
- Preserve timestamped transcript segments with participant attribution where
  available. Mark uncertainty instead of inventing a speaker or missing words.
- Give each captured session a stable identity and a shareable source link.
- Produce a concise summary of the substance, explicit decisions, unresolved
  questions, and stated follow-ups. Include owners or dates only when supported.
- Distinguish a suggestion, a disagreement, and an agreed decision. A summary
  must not silently turn brainstorming into a company commitment.
- Let people inspect the underlying transcript and correct the session summary.
- Show processing, incomplete capture, and failure states honestly. A partial
  transcript must not be presented as a complete account.

For persistent rooms, a session is a bounded conversation within the channel.
The exact boundary policy for empty rooms, reconnects, and long-running calls
must be decided during implementation. Reconnects and processing retries should
update the same session rather than create duplicate records.

### Findable, grounded memory

- Session content must be retrievable by Lor through the existing memory/source
  system and findable by people through the relevant search experience.
- Text questions can refer to past voice conversations and receive links back to
  the relevant session and transcript passages.
- Preserve the source and time behind remembered decisions. New discussion can
  supersede an old decision without erasing its history.
- Session content and derived memory must respect the source channel's access.
  Shared workspace memory must not broaden access to a restricted conversation.
- Summary corrections and source deletion must propagate to derived retrieval
  or memory so stale statements do not remain authoritative.

Transcript capture, durable source storage, and synthesis into company memory
are separate concerns. Phase 1 requires that conversations are usable as
sources; the exact timing and mechanism of brain synthesis remain open.

### Phase 1 completion criteria

Use focused code review and manual use in real team conversations, following the
repository's no-tests policy.

- Teammates can join, talk, share a screen, navigate, and reconnect successfully.
- Capture state is understandable to both existing participants and late joiners.
- A captured conversation produces one durable, accessible session record.
- A person who missed the conversation can understand its outcome and inspect
  the source; corrections remain visible on subsequent retrieval.
- Lor can answer a text question about that conversation with grounded links.
- Restricted content stays restricted, including through derived memory.
- Capture or processing failures are visible and do not break the voice call.
- The team chooses to use this for ordinary work without requiring live voice AI.

## Phase 2 — Explicit voice interaction with Lor

Add this after the voice and memory foundation is useful in real team use.

- Invoke Lor explicitly, initially with a phrase such as "Hey Lor" and a button
  fallback. The invocation wording and interaction design are still proposals.
- Make listening, acknowledging, working, and responding states understandable.
- Allow brief spoken answers and clarification questions; place detailed sources,
  files, progress, and results in the associated text conversation.
- Let the human discussion continue while background work runs. Prefer visual
  updates over unsolicited spoken interruptions.
- Support follow-up instructions and cancellation. Resolve competing directions
  from teammates explicitly rather than silently applying the last utterance.
- Reuse Lor's existing agent execution, tool permissions, approvals, and history.
  Attribute a request to its authenticated participant; hearing speech does not
  grant additional authority or bypass approval requirements.
- Separate discussion of an action from an actual request to execute it. Ask for
  clarification when the intended action, requester, or target is ambiguous.

Initial examples: retrieve a prior decision, investigate a reported issue,
draft an issue from the discussion, or start a requested analysis. Expand based
on the team's actual use of connected tools.

### Jev: candidate decision component

Jev is a candidate for focused decisions such as whether a transcribed utterance
addresses Lor or continues an active request. TypeSafe documents structured
decisions with probabilities/confidence; see the [official introduction](https://docs.typesafe.ai/introduction).

The proposed role is an intent filter after transcription. Speech capture,
transcription, response generation, speech output, and execution remain separate
parts of the system. Assess behavior with overlapping speakers, ambiguous
references, and background discussion before selecting it. Model confidence
does not replace application permissions or user authorization.

No Jev dependency or provider commitment is required for Phase 1.

## Longer-term possibilities

Once explicit interaction works well, explore more natural follow-ups,
selective offers to help, and coordination across voice, text, and shared work
surfaces. Ambient intervention and automatically inferred tasks are future
explorations, not launch requirements.

## Boundaries and open decisions

The first phase does not include spoken AI participation, autonomous action from
overheard conversation, a full meeting/calendar product, video recording,
collaborative document editing, or a code-channel workbench.

Resolve these before implementation depends on them:

- Voice transport/provider and the first supported clients; desktop/web/mobile
  capability expectations, including background audio.
- Relationship between a voice channel and its text history in navigation.
- Capture defaults, who can enable/stop it, and participant notification behavior.
- Whether raw audio is retained; retention/deletion rules for audio, transcripts,
  summaries, and derived memory. Transcription does not imply permanent audio storage.
- Session boundaries, transcription delivery, and processing recovery behavior.
- Correction controls and source/citation integration with existing search and brain.
- Latency and operating-cost targets based on typical team sessions.

## Existing foundations to inspect and reuse

- `apps/web/src/components/chat/meeting-recording-card.tsx`: meeting presentation.
- `packages/lor/src/meeting-insights.ts`: summary and follow-up generation.
- `apps/api/src/routes/v1/integrations/attio/index.ts`: external meeting ingestion.
- [Agent harness](./agent-harness.md): execution and continuation infrastructure.
- [Approval policies](./approval-policies.md): action authorization.
- [Product direction](./product-direction.md): broader workspace vision.

These are starting points to inspect, not evidence that native voice or memory
requirements above are already implemented. Keep this spec updated as product
decisions become concrete; put implementation details in a separate runbook.
