# Voice channels and shared memory

**Status:** Guiding product spec; not an as-built reference or implementation plan.
**Updated:** 2026-09-28
**Direction:** Build voice channels with conversation memory first. Add live voice interaction with Lor afterward.

**Implementation:** executed phase by phase from the
[voice channels runbook](./voice-channels-runbook.md).
**Research:** [LiveKit Cloud research — 2026-09-27](./voice-channels-livekit-research.md).
Where the research and this spec disagree, the decisions recorded here on
2026-09-28 win.

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
- Start with LiveKit Cloud for calls and LiveKit Inference for transcription.
  Use separate participant streams for attribution. Defer direct Deepgram/BYOK
  and custom silence filtering; the initial priority is reliable capture.
- The first release focuses on human conversation and memory. Live spoken AI
  responses, wake words, and voice-triggered tasks are a later phase.
- Code channels remain a future direction. Their interaction design is still
  unresolved; they are not a dependency for this feature.
- Direct multiplayer document editing is not a prerequisite for this work.
- The voice channel itself is the permanent home for its calls and their
  history. Avoid a separate meetings dashboard or inbox unless usage
  demonstrates a concrete need.
- The voice channel model below was decided on 2026-09-28. Model selection and
  the public launch date remain open; implementation detail lives in the runbook.

## Voice channel model

Decided 2026-09-28.

### Persistent channels, bounded sessions

- Voice channels are persistent, in the style of Discord. Opening one never
  connects audio: it shows the live session, if any, and the session history.
  An explicit Join connects.
- A session starts when the first person joins an empty voice channel. It ends
  two minutes after the last person leaves; a rejoin inside that window
  continues the same session. The grace period is tunable: a code constant for
  the MVP, and a workspace setting only if teams ask for one.
- Reconnects, device transfers, and processing retries update the same session
  rather than create duplicates.
- Long-running rooms are not split in the MVP. If all-day rooms appear, revisit
  a split after long silence or a manual "New session" action.
- Sessions where only one person joined and nothing was said or posted are
  stored but hidden from the history.

### Session chat

- Each session has one text conversation for links, files, and messages, and
  later for Lor's visible work. Voice channels have no channel-wide chat.
- When people revisit a voice channel they see its session history. A past
  session's chat and transcript appear only when someone opens that session.
- The session chat stays open after the call. Follow-ups belong there, and so
  does Lor work that finishes after the call: results, approval requests, and
  questions for the person who asked.
- Returning to an old session must be easy. A mention or reply in a session
  chat notifies like other thread activity and opens the exact message in its
  session. Session history rows show unread and mention state.

### Live-only visibility

- While a session is live, only people currently in the call can see its
  transcript and its chat. Nobody can follow a live call without visibly
  joining it.
- After the session ends, everyone with channel access can read it, and Lor can
  answer questions about it.
- Mentioning someone who is not in a live call sends them a notice with a Join
  action and no message text. After the session ends, the same notification
  opens the message.

### Presence

- The sidebar lists the people in a call under its voice channel, one row per
  person. This is chosen presence. Lor never shows who is viewing a channel or
  reading a session.
- People who have not joined get no audio and no speaking indicators.

### Call scope

- A person has one call at a time. The call follows them across the app,
  including DMs. Switching workspaces ends it after a confirmation.
- A second device offers "Transfer here" instead of joining as a second
  participant.
- Closing the macOS app window ends the call.

### Transcription

- Every session is transcribed. There is no stop control and no pre-join
  transcription notice; the privacy policy can cover transcription if needed.
- Each device has a CC toggle that shows or hides live captions for that
  person. Captions start on. The toggle never affects transcription.
- Transcripts are kept forever, like all team data: Lor aims to be the team's
  system of record.
- No audio or video recordings. This includes LiveKit's agent observability
  audio, which must be switched off explicitly.

### Clients and media

- Supported clients: web in desktop browsers, the macOS app, and the iPhone
  app. Android, Windows and Linux desktop builds, and phone browsers are out of
  scope.
- Camera video on phones and computers. The camera starts off when someone
  joins.
- Screen sharing from computers. Phones can view a share, including in a
  landscape or full-screen viewer, but cannot start one.
- A call holds at most 30 people, matching the largest team size Lor currently
  targets.

### Permissions

- Channel access governs viewing history, joining, speaking, camera, and screen
  sharing.
- New permission statements cover moderation, such as removing someone from a
  call, and deleting a session.

## The experience we want

### First release: a conversation the team can return to

1. A teammate opens a voice channel, sees who is in the live session, and joins.
2. The team discusses a customer issue, turns on cameras, shares a screen, and
   drops links and files into the session chat.
3. They agree on a next step and leave. The session ends shortly after.
4. The session appears in the channel's history with its chat and transcript.
5. A teammate who missed the discussion opens the session, reads the outcome,
   and inspects the transcript behind it.
6. Someone asks Lor in text, "What did we decide about this, and why?" Lor can
   retrieve that session and ground its answer in the source conversation.

### Later: Lor helps during the conversation

1. A participant addresses Lor: "What did we decide about this last week?"
2. Lor briefly answers, with sources visible in the session chat.
3. Someone asks Lor to investigate the implementation while the team keeps talking.
4. The existing agent system runs the work and shows progress and results in
   the session chat, for example a Linear ticket or a CRM update as it happens.
5. Teammates clarify the request, review the result, and approve actions where
   the workspace's existing policies require it.
6. The session preserves the discussion, requested work, and outcomes together.

## Phase 1 — Voice channels with memory

### Everyday voice experience

- Explicit Join from the voice channel page, with visible participants and
  speaking indicators.
- Camera video, mute/deafen, input/output device selection, and clear
  connection state.
- Screen sharing from computers; share viewing on every client.
- A persistent call bar keeps call controls available while navigating.
- Reliable join, leave, reconnect, and transfer behavior.
- A session chat for links, files, and messages.

The audio experience must stand on its own. A transcription or summarization
failure must not end the call or prevent people from continuing to talk.

### Transcripts and session records

- Preserve timestamped transcript segments with participant attribution where
  available. Mark uncertainty instead of inventing a speaker or missing words.
- Give each session a stable identity and a shareable source link.
- Produce a concise summary of the substance, explicit decisions, unresolved
  questions, and stated follow-ups. Include owners or dates only when supported.
- Distinguish a suggestion, a disagreement, and an agreed decision. A summary
  must not silently turn brainstorming into a company commitment.
- Let people inspect the underlying transcript and correct the session summary.
- Show processing, incomplete transcripts, and failures honestly in the session
  record and in live captions. A partial transcript must not be presented as a
  complete account.

### Findable, grounded memory

- Session content, chat and transcript together, must be retrievable by Lor
  through the existing memory/source system and findable by people through the
  relevant search experience.
- Text questions can refer to past voice conversations and receive links back to
  the relevant session and transcript passages.
- Preserve the source and time behind remembered decisions. New discussion can
  supersede an old decision without erasing its history.
- Session content and derived memory must respect the source channel's access.
  Shared workspace memory must not broaden access to a restricted conversation.
- A live session stays out of search and Lor retrieval for anyone outside the
  call until it ends.
- Summary corrections and source deletion must propagate to derived retrieval
  or memory so stale statements do not remain authoritative.

Transcript capture, durable source storage, and synthesis into company memory
are separate concerns. Phase 1 requires that conversations are usable as
sources; the exact timing and mechanism of brain synthesis remain open.

### Phase 1 completion criteria

Use focused code review and manual use in real team conversations, following the
repository's no-tests policy.

- Teammates can join, talk, use cameras, share a screen from a computer,
  navigate, transfer devices, and reconnect successfully.
- People with CC on see live captions, and late joiners also see the session's
  earlier transcript and chat.
- Every conversation produces one durable session with its chat and transcript.
- Nobody outside a live call can see its chat or transcript; everyone with
  channel access can after it ends.
- A person mentioned in an old session chat reaches the exact message in one step.
- A person who missed the conversation can understand its outcome and inspect
  the source; corrections remain visible on subsequent retrieval.
- Lor can answer a text question about that conversation with grounded links.
- Restricted content stays restricted, including through derived memory.
- Transcription or processing failures are visible and do not break the call.
- The team chooses to use this for ordinary work without requiring live voice AI.

## Phase 2 — Explicit voice interaction with Lor

Add this after the voice and memory foundation is useful in real team use.

- Invoke Lor explicitly, initially with a phrase such as "Hey Lor" and a button
  fallback. The invocation wording and interaction design are still proposals.
- Make listening, acknowledging, working, and responding states understandable.
- Allow brief spoken answers and clarification questions; place detailed sources,
  files, progress, and results in the session chat.
- Show Lor's work in the session chat as it happens: connector actions such as
  Linear tickets or CRM updates, and later a live view of Lor's own browser that
  participants can follow.
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
explorations, not launch requirements. Call controls outside the desktop app
window, such as in the menu bar, are also a later idea.

## Deferred: private questions to Lor

People will want to ask Lor about a session without posting a public question.
This is a platform decision, deferred on 2026-09-28; see
[Private questions to Lor](./private-lor-questions.md). Until then, people ask
Lor in the session chat or in a text channel.

## Boundaries and open decisions

The first phase does not include spoken AI participation, autonomous action from
overheard conversation, a full meeting/calendar product, audio or video
recording, collaborative document editing, a code-channel workbench, screen
sharing from phones, Android, or Windows and Linux desktop builds.

Resolved on 2026-09-28 (see "Voice channel model"): supported clients, the
relationship between a voice channel and its text, transcription defaults,
retention, and session boundaries.

Still open:

- Transcription delivery and processing recovery details (see the runbook).
- Correction controls and source/citation integration with existing search and brain.
- Latency and operating-cost targets based on typical team sessions.
- Privacy policy wording for always-on transcription, if needed.
- Private questions to Lor (deferred).

## Existing foundations to inspect and reuse

- `apps/web/src/components/chat/meeting-recording-card.tsx`: meeting presentation.
- `packages/lor/src/meeting-insights.ts`: summary and follow-up generation.
- `apps/api/src/routes/v1/integrations/attio/index.ts`: external meeting ingestion.
- [Agent harness](./agent-harness.md): execution and continuation infrastructure.
- [Approval policies](./approval-policies.md): action authorization.
- [Product direction](./product-direction.md): broader workspace vision.

These are starting points to inspect, not evidence that native voice or memory
requirements above are already implemented. The runbook maps the implementation
onto existing code. Keep this spec updated as product decisions become concrete;
put implementation details in the runbook.
