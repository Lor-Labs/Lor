# Sidebar presence and Lor activity: execution plan

Prepared for GPT 5.6 on 2026-09-14. This is an implementation handoff, not a claim that the reported presence bug has been reproduced or fixed.

## Objective and boundaries

Make Lor's channel sidebar status update promptly after persisted state changes, and diagnose/fix users seeing only their own channel avatar. Preserve the accepted sidebar appearance, dimensions, spacing, spinner, avatar placement, and menu overlay behavior. Do not implement voice or relocate DMs in this task.

Read `AGENTS.md` and `CLAUDE.md` first. Never generate, add, or run tests, test runners, ad hoc test scripts, browser test harnesses, or `pnpm run validate`. Use focused code review, lint, type checking, and ordinary manual inspection of the running app. Preserve existing staged and unstaged work; this branch already contains the sidebar implementation.

## Verified current behavior

- `apps/web/src/hooks/use-workspace-activity.ts`: `useChannelPresence` emits `presence:channel` on navigation, focus changes, connection, and every 15 seconds. It sends `null` on blur/hidden state and cleanup. It currently does not consume its acknowledgement.
- `apps/web/src/lib/app-focus.ts`: presence requires a visible document AND `document.hasFocus()` AND native focus when available. Two windows/accounts on one computer cannot both satisfy this continuously. Global online presence does not have this requirement.
- `apps/web/src/components/sidebar/index.tsx`: `ChannelPresenceTracker` calls the hook at the stable layout level. Keep it independent of whether the sidebar drawer is mounted.
- `apps/web/src/components/sidebar/channel-panel/channel-activity.tsx`: the provider unconditionally adds the current signed-in user to the route's channel and removes that user from other rows. This happens even with no successful server snapshot or acknowledgement, including disconnect/blur. Therefore a self-avatar is not evidence that publishing works.
- `apps/realtime/src/index.ts`: channel updates are serialized per socket; access is authorized; entries are keyed by channel, user, and socket. Changes/removals emit `workspace:activity:updated` to the workspace room. The gateway uses a Redis Socket.IO adapter and joins workspace rooms during connection initialization.
- `apps/realtime/src/services/workspace-activity.ts`: Redis entries are refreshed every 15 seconds, filtered/pruned after 30 seconds, and the containing key expires after 60 seconds. Snapshot reads check workspace membership and accessible channels, deduplicate users within a channel, and return three avatars plus the total count.
- The snapshot also reads persisted `agentRun` and `plan` rows. Priority is working/finalizing, queued, waiting for approval, waiting for input, then no indicator. It aggregates all threads in a channel.
- `useWorkspaceActivity` refreshes after the workspace invalidation event, on connect/focus, and every 15 seconds as fallback. It serializes requests and queues one refresh if a request is in flight. Failed/timed-out snapshots clear the snapshot and retry.
- The only current `workspace:activity:updated` publishers are channel presence changes in the gateway. Lor state changes do not publish this event. Existing message/plan stream events target channel/thread rooms, which cannot update every sidebar channel for users who have not joined those rooms.

## 1. Diagnose the missing remote avatars before changing semantics

Use two authenticated accounts in the same workspace with access to the same channel. Prefer separate devices with both app windows focused. If using one computer, explicitly record focus for each window: switching accounts can legitimately clear the other window's current viewing presence.

Trace one participant from publisher to recipient and record where data first disappears:

1. Check the effective realtime endpoint on both clients and which gateway build is serving it. A new local web build can still point to an older deployed gateway. Confirm both have `presence:channel` and `workspace:activity` handlers, and share the intended database/Redis environment. Do not print tokens, cookies, or full environment files.
2. Observe `presence:channel` payload, its acknowledgement, connection status, focus state, and selected channel. A timeout suggests an absent handler or transport failure; an error acknowledgement suggests authorization/payload/server failure. Surface bounded development diagnostics rather than swallowing both.
3. Inspect only the relevant `presence:channel-viewers:<workspaceId>` Redis key read-only. Verify both channel/user/socket entries and their timestamps while the users qualify as viewers. Never insert fake presence as the fix.
4. Inspect the recipient's `workspace:activity` acknowledgement. Confirm it contains both viewers and the expected count. Check workspace ID lookup, membership/access filtering, and user membership lookup if entries exist in Redis but not the response.
5. Check receipt of `workspace:activity:updated`, workspace-room membership after initialization, and reconnection. If polling also never returns the remote user, a missed broadcast alone is not the explanation.
6. Inspect provider merging only after a valid snapshot is confirmed. Verify incoming remote viewers survive the optimistic self overlay and the three-avatar limit/count logic.

The screenshot establishes a symptom, not a root cause. Global online status alone is not channel viewing presence. Do not assert that deployment, focus, permissions, or Redis is the cause until the trace establishes it.

### Required presence hardening

- Add acknowledgement handling with a bounded timeout for channel publishing, and distinguish pending/confirmed/error/disconnected state internally. Tag requests by socket connection generation and navigation revision; ignore stale acks after switching channel, blur, unmount, or reconnect.
- Retain immediate optimistic self movement for a healthy session, but reconcile it with successful publication. Do not leave a self-avatar indefinitely visible after rejection, timeout, disconnect, or ineligibility. Clear stale remote snapshots on disconnect; never replace them with a fabricated healthy self-only snapshot.
- Share the eligibility and confirmed/optimistic selection between the publisher and provider using a narrowly scoped context/store. Do not add a second publishing hook in each sidebar row or remount it with the mobile drawer. Preserve avatar metadata during optimistic moves.
- Reconcile on `presence:ready` as well as connection if the trace confirms room-initialization races. Inspect existing `SocketProvider` focus-driven reconnect behavior before adding listeners or reconnects.
- Keep per-socket server serialization, authorization, per-channel user deduplication, and expiry. A disconnect from one socket must not clear another socket's record. The server may legitimately represent one user in different channels on separate devices; local optimistic navigation must not erase confirmed presence from another device. If needed, track the current socket's acknowledged previous channel instead of deleting the current user from all channels.
- Preserve the current focused-viewer rule in this task. If focus explains the report and the desired product behavior is instead “channel open in a visible window,” document that finding and the proposed channel-specific eligibility change. Do not silently weaken the shared `isAppFocused` utility, which other features use. Voice participation will be a separate state independent of focus.
- Fix the confirmed transport/filtering/lifecycle defect and record evidence. If two accounts/devices are unavailable, complete code hardening but explicitly leave cross-user runtime verification outstanding; never claim success from the optimistic avatar alone.

## 2. Push Lor invalidations through existing infrastructure

Use the existing event and authenticated snapshot path:

`committed run/plan state mutation → workspace:activity:updated { workspaceId } → visible workspace client refreshes → server computes authorized channel activity → sidebar renders`

This deliberately pushes an invalidation followed by a snapshot request. It eliminates waiting for the 15-second interval while preserving one authoritative aggregation and permission filter. Do not broadcast raw plan/run data or private-channel identifiers to all workspace members. Do not subscribe every client to every channel or emit on every token/tool/reasoning frame.

### Publisher wiring

- Gateway producers use the existing `io.to(workspaceRoom(workspaceId)).emit(...)`.
- Worker producers use their existing typed Redis emitter from `apps/worker/src/index.ts`.
- API producers use `getEmitter` in `apps/api/src/lib/bot-messages.ts`.
- Pass a small host-supplied callback through shared lifecycle helpers where needed; avoid new global Redis connections, circular package dependencies, or importing app modules into packages. Keep any shared callback type free of server dependencies, for example in `packages/realtime-types`.
- Emit only after a mutation actually changes a matching row and its transaction commits. Use `returning` to distinguish successful guarded writes from no-ops; preserve all lease/CAS guards. Do not emit from inside a transaction that can roll back.
- Publish failures must not turn a committed run transition into a failed job or skip cleanup. Log bounded context and retain snapshot fallback for recovery. Do not introduce an outbox/migration for this task; explicitly retain best-effort delivery plus reconciliation.

### Run transition coverage

Audit state-changing writes and attach invalidation at the lowest practical lifecycle boundary. Keep a coverage checklist in this document as implementation proceeds.

| Transition/path | Starting points to inspect |
| --- | --- |
| Initial queued runs and enqueue failure cleanup | `apps/realtime/src/services/lor.ts`, `apps/api/src/lib/scope-runs.ts` |
| Queue drain/continuations and spawned plan runs | `apps/worker/src/lib/run-queue.ts`, `apps/worker/src/lib/lor-plan.ts` |
| Scheduled/manual loop runs | `apps/worker/src/jobs/sweep-due-loops.ts`, `apps/api/src/lib/loops.ts` |
| Triggered Act runs | `packages/lor/src/act-runs.ts` and API/worker host callers |
| Claim queued → working, recovery claim, exhausted attempts → failed | `apps/worker/src/lib/agent-run.ts` (`claimAgentRun`) |
| Working/finalizing → complete, failed, stopped | `apps/worker/src/lib/run-events.ts` (`createRunEventWriter().transition`) |
| Early stops before normal execution | `apps/worker/src/lib/unattended-run.ts`, worker job error/early-return paths |
| Queued cancellation and working stop request | `apps/api/src/routes/v1/runs/handlers.ts`, loop cancellation callers |
| Dead-run sweep and orphan/failed-enqueue cleanup | `apps/worker/src/jobs/prune-run-events.ts` and creation failure paths |

Search all `agentRun` inserts, state updates, deletes, and `writer.transition` calls again; the table is a starting inventory. A stop request alone does not mean the worker has stopped: leave working visible until the persisted state becomes terminal. A failed guarded update or a lease heartbeat must not generate a state-change event. Handle a queued run deleted after failed enqueue so its indicator clears.

`run-events.ts` currently appends/flushed state events before its guarded database update, and swallows update errors. Wire sidebar invalidation to the successful row update, not to the appended event. Do not alter event replay semantics as a side effect.

### Plan transition coverage

- `packages/lor/src/plans.ts`: `updatePlan`, `settleAbandonedRunPlan`, and their `onPlanUpdated` callbacks.
- `apps/worker/src/jobs/lor-respond.ts`: direct plan writes and plan callback construction.
- `apps/worker/src/lib/lor-plan.ts`: creation/failure paths and callbacks.
- `apps/api/src/lib/scope-runs.ts`: `emitPlanUpdated` and continuation/resume writes.
- `apps/api/src/routes/v1/approvals/handlers.ts`: approval resolution and failed resume paths.
- `apps/realtime/src/index.ts`: plan continuation/settlement paths that emit `plan:updated`.
- Dead-run settlement callbacks and unattended/triggered/loop callers.

Preserve existing channel-scoped `plan:updated` events. Add workspace invalidation when the plan enters or leaves a waiting status, or otherwise changes the sidebar aggregate. Prefer extending shared host callbacks over duplicating per-tool behavior. Avoid workspace invalidation for every plan step-description update if its status is unchanged. Inspect all direct writes so callback-free paths are covered.

## 3. Keep snapshot aggregation and client recovery correct

- Preserve current aggregate precedence: any working/finalizing run wins; otherwise any queued run wins; then any waiting approval; then waiting input; otherwise null. Completing one of several concurrent runs must not clear another run's spinner. Re-read current state instead of assigning the last event's state to a whole channel.
- In `useWorkspaceActivity`, add a short bounded coalescing window (about 75–150 ms) for bursts. Keep at most one request in flight and one queued refresh. A constant stream of events must not postpone refresh indefinitely.
- Refresh immediately on connect/ready and return to focus. Preserve the 15-second fallback initially for missed events, expiry, and best-effort publisher failures. This is recovery, not the normal Lor update mechanism.
- Audit generation/timer/queued-refresh handling around timeout, disconnect, workspace switch, and focus clearing. A queued old-workspace response must never overwrite the new workspace. Do not accidentally cancel a timeout and leave the hook permanently pending.
- Leave a healthy visible snapshot in place during an ordinary background refresh; avoid transient empty/self-only flashes. Failed reads must remain observable internally, and stale/unauthorized data must not be treated as current indefinitely.
- No new per-row fetches. Keep one snapshot subscription for the workspace. Coalescing should prevent a run completion followed by a plan update from producing an avoidable refresh storm. Broader snapshot-query optimization is outside scope unless profiling exposes a concrete blocker.

## 4. Verification and completion evidence

Run Biome on changed files, `git diff --check`, and the affected packages' non-test type checks. For web, `pnpm --filter web exec tsc --noEmit` avoids unnecessary route generation. Worker/realtime have `check-types` scripts that run `tsc --noEmit`; inspect other package scripts before using them. Never run the aggregate validate command.

Through ordinary manual app inspection, record these outcomes where the required accounts/environment are available:

- Two distinct focused users in the same channel each receive a server snapshot containing both people. Moving either user to another channel is reflected on the other client promptly, without waiting for polling.
- Blur/hidden/disconnect behavior matches the documented focused-viewer rule; self rendering follows the same rule. Return/reconnect recovers without a reload. Rapid navigation does not resurrect a prior channel entry.
- Duplicate sessions in the same channel count once. Closing one does not remove the other. Confirmed other-device presence is not erased by local optimism. Private channel activity is absent from unauthorized snapshots.
- From a different open channel, observe queued, working, completion, failure, stop, input-needed, approval-needed, and resume transitions in the sidebar. Include concurrent runs and a plan waiting while another run is active.
- In a local environment, inspect timestamps from committed mutation through invalidation receipt and snapshot render. Target approximately one second or less under ordinary local load; report measured latency, not a guarantee. The event path must work before the next 15-second fallback tick.
- Inspect recovery from a dropped connection and from a missed invalidation through the existing fallback. Confirm the accepted menu/avatars/spacing are visually unchanged.

Do not create/send messages to other people or trigger paid Lor work solely for verification without explicit authorization. Use existing local activity/accounts where possible; list unavailable scenarios honestly.

Completion report must include: the observed remote-avatar root cause (or precise remaining uncertainty), the fix, the run/plan transition coverage, non-test checks performed, manual observations, and any deployment steps required to align web/gateway/API/worker versions. Do not report the presence issue fixed solely because each account sees itself.

## Suggested execution order

1. Trace and record remote-presence failure; harden acknowledgements and self reconciliation.
2. Add reusable host publisher wiring and cover committed run lifecycle transitions.
3. Cover plan waiting/resolution transitions and abnormal cleanup paths.
4. Harden/coalesce snapshot refresh and reconnect recovery.
5. Complete focused checks and available manual observations; update this plan with completed coverage and remaining limitations.

## Implementation status (2026-09-14)

### DECISION (2026-09-14, Jacob): channel viewer avatars removed

Per-channel user presence avatars were cut as a product decision after
implementation: viewing presence in chat channels reads as surveillance and
creates response pressure. Everything presence-specific was deleted end to end
(client publisher hook + self-presence store, `ChannelViewers` UI,
`presence:channel` event, gateway viewer tracking, Redis
`presence:channel-viewers:*` keys, viewers/members in the snapshot).
`ChannelActivity` is now `{ channelId, lor }`. The Lor state indicator
(spinner/queued/needs-attention) stays — it is operational truth, not
attention tracking — on the push-invalidation + snapshot path below. Live
co-presence may return later as a per-surface feature (e.g. realtime AI canvas
documents), not in core channels. Sections 1 and the presence half of section
4 are therefore obsolete; the remote-avatar diagnosis is moot.

### Publisher wiring (done)

- Worker: `apps/worker/src/lib/workspace-activity.ts` — module-level `notifyWorkspaceActivity(workspaceId)` fed the shared Redis emitter at bootstrap (`setWorkspaceActivityEmitter` in `apps/worker/src/index.ts`). Best-effort: publish failures log-and-swallow, never fail a committed transition.
- API: `apps/api/src/lib/workspace-activity.ts` — same contract over `getEmitter()`.
- Realtime gateway: direct `io.to(workspaceRoom(...)).emit(...)`.
- packages/lor stays transport-free: `flushActWindow` takes an optional `notifyWorkspaceActivity` callback; `OnPlanUpdated` gained `meta.statusChanged` so hosts invalidate only on status moves (never step-only updates).

### Run transition coverage (done)

- [x] queued→working claim + exhausted→failed — `apps/worker/src/lib/agent-run.ts` (exhausted branch now uses `.returning`)
- [x] finalizing/complete/failed/stopped funnel — `apps/worker/src/lib/run-events.ts` `transition` now `.returning({workspaceId})`; invalidation keyed to the successful guarded row update, not the appended event
- [x] queued cancel (kill switch) — `cancelPendingRun` in `apps/worker/src/lib/unattended-run.ts` (covers triggered-run + loop-run callers)
- [x] dead-run sweep + orphaned placeholders — `apps/worker/src/jobs/prune-run-events.ts` (run fail + plan settle)
- [x] follow-up run create/unwind — `apps/worker/src/lib/run-queue.ts`
- [x] spawned plan first run create/unwind — `apps/worker/src/lib/lor-plan.ts`
- [x] loop sweep create/unwind — `apps/worker/src/jobs/sweep-due-loops.ts`; manual run-now create/unwind — `apps/api/src/lib/loops.ts`
- [x] Act batch create/unwind — `packages/lor/src/act-runs.ts` via callback from `apps/worker/src/jobs/triggered-run.ts`; immediate Act create/unwind — `apps/api/src/lib/act-runs.ts`
- [x] continuation run create/unwind — `apps/api/src/lib/scope-runs.ts`
- [x] queued-run user stop — `apps/api/src/routes/v1/runs/handlers.ts` (working-stop only flags; indicator stays until the worker's terminal transition, per plan)
- [x] initial mention run create — `apps/realtime/src/index.ts` (conflict path creates nothing; enqueue-failure leaves the row for the sweep, which now notifies)

### Plan transition coverage (done)

- [x] `updatePlan` computes `statusChanged` (CAS-aware) and `settleAbandonedRunPlan` always passes it — `packages/lor/src/plans.ts`; covers update_plan reopen, complete_plan, request_approval, fileParkedApproval through hosts' `onPlanUpdated`
- [x] worker settlePlan + plan claim + emitPlanUpdated meta — `apps/worker/src/jobs/lor-respond.ts`
- [x] API `emitPlanUpdated(plan, meta)` + approval resolve/park paths — `apps/api/src/lib/scope-runs.ts`, `apps/api/src/routes/v1/approvals/handlers.ts`, `apps/api/src/routes/v1/runs/handlers.ts`
- [x] realtime abandoned-plan settles — `apps/realtime/src/index.ts`
- Plan inserts (born `running`) deliberately don't invalidate: running plans aren't in the sidebar aggregate and the run claim covers the spinner.

### Client (done; presence parts removed per the decision above)

- `useWorkspaceActivity`: 100 ms fixed-deadline coalescing for invalidation bursts, one request in flight + one queued, healthy snapshot kept through transient failures (cleared after 3 consecutive), 15s poll + connect/focus refresh retained as recovery.
- Provider (`channel-activity.tsx`) is a thin channelId→activity map; `LorChannelStatus` renders spinner (working), dot (queued), and `!` badge (needs input/approval).

### Checks performed / outstanding

- `pnpm run check-types` (all 20 tasks green), Biome on all changed files, `git diff --check` — clean, re-run after the avatar removal. No tests run (repo policy).
- Outstanding (needs live env with a second observer): watching queued/working/terminal/waiting transitions appear in another user's sidebar without waiting for the poll; measured mutation→render latency.
