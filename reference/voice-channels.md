# Voice channels and shared memory

**Status:** Guiding product spec; not an as-built reference or implementation plan.
**Updated:** 2026-09-30
**Direction:** Voice channels whose calls Lor can join by being addressed, showing its work on a shared stage, with the conversation kept as team memory.

**Implementation:** executed phase by phase from the
[voice channels runbook](./voice-channels-runbook.md). Delivery order: calls,
session chat, transcription, Lor in the call, the iPhone app, then memory and
Q&A.
**Research:** [LiveKit Cloud research — 2026-09-27](./voice-channels-livekit-research.md).
Where the research and this spec disagree, the decisions recorded here on
2026-09-28 and 2026-09-30 win.

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
- The first release covers human calls, the session chat, and transcription.
  Lor joining the call by voice follows directly after (see "Lor in the call").
  The aim is to be much better than a huddle, not a copy of one: Lor puts live,
  interactive objects in front of the whole call instead of someone sharing
  their screen.
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

- Each session has one text conversation for the people in it: messages, links,
  and files, with the same look as chat elsewhere in the app. Voice channels
  have no channel-wide chat.
- The session chat is for humans. Lor reads it as background context when
  someone addresses Lor by voice, but never takes it as a command: typing
  "@Lor" there does nothing, and the server enforces that. Lor's own work lives
  in Lor's window and the Lor tab, not in the chat.
- When people revisit a voice channel they see its session history. A past
  session's chat and transcript appear only when someone opens that session.
- The session chat stays open after the call, so follow-ups belong there.
- Returning to an old session must be easy. A mention or reply in a session
  chat notifies like other thread activity and opens the exact message in its
  session. Session history rows show unread and mention state.

### Live-only visibility

- While a session is live, only people currently in the call can see its
  transcript, its chat, and Lor's work in it. Nobody can follow a live call
  without visibly joining it.
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

## Lor in the call

Decided 2026-09-30. Screen sharing puts pixels in front of a call: nobody else
can click, edit, or keep what they see, and one person drives while everyone
waits. Lor instead shows live, interactive objects to the whole call, and what
it shows becomes part of the session record.

### Asking Lor

- Voice only, and ambient: nobody holds a button. Lor acts when someone
  addresses it directly, such as "Lor, pull up the tickets I created
  yesterday" or "Hey Lor, …". Its name mentioned in passing ("we should ask
  Lor") never starts anything.
- A second check confirms the sentence is a request to Lor before anything
  runs (see the Jev section below).
- Lor doesn't speak, for now. It answers on screen.
- A request runs as the person who spoke it, with Lor's full toolset and the
  workspace's approval policies. Hearing speech grants no extra authority.

### Lor's window

- Lor's window appears only when someone addresses Lor. It never shows at the
  start of a call and isn't always on.
- It takes the screen-share slot, where the room's attention already goes. It
  opens with a thinking animation and a line showing what Lor heard, with a way
  to cancel. It then shows the result, and animates away when it's cleared or
  the result is no longer needed.
- Everyone in the call sees the same window. Anyone can clear it, or step back
  through this session's earlier results ("2 of 3").
- Results render as purpose-built cards: Linear issues and GitHub pull requests
  first. People can open and act on them from the card. Later, a small kit of
  generic pieces (cards, lists, tables, simple charts) covers requests no
  purpose-built card fits. Lor never writes arbitrary UI code for the window.
- Later, when Lor gets browser or computer use, a live view of its screen shows
  in this same window.

### The Lor tab

- Next to the chat, the Lor tab lists every request in the session: who asked,
  what Lor heard, what it did, and the result, which reopens as cards.
- Anyone can look back through it without moving everyone's window, and "Show
  on stage" brings an earlier result back for the whole call.
- After the call, a session opens with Chat, Lor, and Transcript tabs.

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

### Next: Lor helps during the conversation

1. A participant says, "Lor, pull up the tickets I created yesterday."
2. Lor's window slides into the screen-share slot: a thinking animation, then
   the five Linear tickets as cards everyone can open.
3. "Lor, draft tickets for what we just agreed." Draft cards appear; the team
   adjusts them and creates them, with approvals where policy requires.
4. The team keeps talking while Lor works; the window clears when they move on.
5. The session keeps the discussion, the chat, and every Lor request and result
   together, and the Lor tab reopens any of them later.

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

## Phase 2 — Lor in the call

Builds on transcription. The model is in "Lor in the call" above; these are the
behaviors to get right.

- Make listening, thinking, working, and showing states understandable in Lor's
  window, and let anyone cancel a request Lor misheard.
- Let the human discussion continue while work runs. Lor shows results; it
  doesn't interrupt.
- Support follow-up instructions and cancellation. Resolve competing directions
  from teammates explicitly rather than silently applying the last utterance.
- Reuse Lor's existing agent execution, tool permissions, approvals, and history.
  Attribute a request to its authenticated participant; hearing speech does not
  grant additional authority or bypass approval requirements.
- Separate discussion of an action from an actual request to execute it. Ask for
  clarification when the intended action, requester, or target is ambiguous.

Initial examples: pull up Linear issues or GitHub pull requests, draft issues
from the discussion, retrieve a prior decision, or investigate a reported
issue. Expand based on the team's actual use of connected tools.

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

- Browser and computer use, shown live in Lor's window.
- Spoken answers, once show-only works well.
- More natural follow-ups, selective offers to help, and coordination across
  voice, text, and shared work surfaces. Lor acting without being addressed,
  or inferring tasks from overheard talk, stays out of scope.
- Call controls outside the desktop app window, such as in the menu bar.

## Deferred: private questions to Lor

People will want to ask Lor about a session without posting a public question.
This is a platform decision, deferred on 2026-09-28; see
[Private questions to Lor](./private-lor-questions.md). Until then, people ask
Lor by voice during the call, or in a text channel afterward.

## Boundaries and open decisions

Out of scope for now: Lor speaking, Lor acting on conversation it wasn't
addressed in, Lor browser or computer use, a full meeting/calendar product,
audio or video recording, collaborative document editing, a code-channel
workbench, screen sharing from phones, Android, and Windows and Linux desktop
builds.

Resolved on 2026-09-28 (see "Voice channel model"): supported clients, the
relationship between a voice channel and its text, transcription defaults,
retention, and session boundaries. Resolved on 2026-09-30 (see "Lor in the
call"): how people ask Lor, Lor's window, the Lor tab, and the chat's role.

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
