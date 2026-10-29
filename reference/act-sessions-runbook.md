# Act sessions runbook (session routing + code mode)

Started 2026-10-28 with Jacob. Act (the unattended effect on connector
triggers and channel webhooks, `automation-primitives.md` §2) can now route an
event into an existing session instead of always starting a new one, and can
start code sessions on a repo. Act runs stay on Pi with Lor's cloud models:
nobody's subscription pays for an unattended run.

## Decisions (Jacob, 2026-10-28)

- **Session mode per trigger** (`connector_trigger.act_session_mode`):
  - `per_event` (default, the old behavior): each run starts a new session.
  - `per_subject`: events about the same thing (same PR, issue, record)
    continue that thing's session; a new subject starts a new session.
  - `ongoing`: every event continues the trigger's one session, like a chat
    Loop's recurring session.
- **The subject key** is stored on each delivery (`trigger_delivery.subject`):
  the connector item's URL (GitHub PR/issue, Linear issue, Attio record) or,
  for webhooks, the optional `subject` field in the native body. No key: the
  event gets its own session, as in `per_event`.
- **A continued session keeps its context.** The event posts as a
  `trigger_run` line into the session and Lor answers it with the earlier
  turns in view. The prior-run briefing is only added to a session's first
  turn (later turns continue from the saved Pi state).
- **People go first.** An event never starts a turn while the target session
  has a run going or a person's message queued. Its deliveries go back to the
  trigger's queue and the flush looks again later. The session shows "N
  events waiting" with a Drop action (`trigger_delivery.act_dropped_at`).
- **Archive is a dismissal**, as for Loops: the next event for that session
  brings it back.
- **One Act run per trigger at a time** stays (the partial unique index on
  `agent_run.trigger_id`). A `per_subject` flush takes one subject's
  deliveries; the rest re-arm for the next flush.
- **Code mode** (`connector_trigger.act_repo_full_name`, `act_base_branch`):
  Act starts code sessions on that repo, each on its own new branch
  (`lor/<event>-<id>`), so a session's work can become its own PR. Code mode
  allows `per_event` and `per_subject` only: `ongoing` would put unrelated
  fixes on one branch. Lor never commits or pushes; a person reviews and
  ships from the session.
- This overrides `workspace-model.md` decision 1 ("each connector-trigger
  event starts a new session") for triggers that choose another mode.

## Steps

- [x] **1. Schema and subject capture.** Columns above (additive `db:push`;
  new enum `act_session_mode`). `dispatchConnectorEvent` stores the subject
  key; the native webhook body accepts `subject`. `agent_session.trigger_subject`
  is on the session wire types (API, realtime, web and mobile optimistic rows).
- [x] **2. Routing in the worker.** Built 2026-10-28 in
  `apps/worker/src/lib/trigger-session.ts` and `flushActWindow`. `startActSession` finds or creates the
  target session per mode, revives archived ones, waits while the session is
  busy (release deliveries, delete the run, re-arm the flush). Per-subject
  flush claims one subject. Dropped deliveries never batch.
- [x] **3. Code mode.** Fire-time repo check (`channelCodeRepo`), a new branch
  per session (`lor/<label slug>-<session id prefix>`). Built 2026-10-28.
  When the repo is no longer available, the event starts a chat session and
  its first line says why. The code prompt tells Lor that in an automation's
  session nobody asked, so it mentions only people the instructions name.
- [x] **4. API.** Webhook and connector-trigger routes read and write
  `actSessionMode` and `actCode: { repo, branch } | null`
  (`apps/api/src/lib/act-target.ts`). Both are optional on update (absent
  keeps the saved value). Save-time checks: no `ongoing` with code; the repo
  and branch are checked when the code target or the trigger's channel
  changes, so a GitHub outage never blocks editing instructions.
- [ ] **5. Waiting events.** Count and Drop routes for a session, a realtime
  nudge when an event starts waiting, "N events waiting" with Drop in the
  session view.
- [ ] **5b. UI.** `TriggerEffects`: session mode select, `Chat | Code` with
  the repo and branch pickers.
- [ ] **6. Live QA.** Webhook and GitHub trigger, each mode, code mode through
  review and push.

## Deviations log

(none yet)
