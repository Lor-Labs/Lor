import { randomUUID } from "node:crypto"
import { checkCredits, recordUsage } from "@repo/billing"
import {
  and,
  db,
  eq,
  isNull,
  isUniqueViolation,
  LOR_USER_ID,
  ne,
  or,
  schema,
} from "@repo/db"
import type {
  LorMemory,
  LorReasoningSegment,
  LorToolCall,
} from "@repo/db/schema"
import { withContext } from "@repo/logger"
import {
  formatSpeakerLine,
  groundCitations,
  respond,
  writeBack,
} from "@repo/lor"
import type { ProposeLoopExecutor } from "@repo/lor/loops"
import type { StartPlanInput } from "@repo/lor/plans"
import { toRealtimePlan } from "@repo/lor/plans"
import type { ProposeChangeExecutor } from "@repo/lor/proposals"
import {
  buildMessageFanout,
  loadThreadSummary,
  sendInstructionsProposalPush,
  sendMessagePushNotifications,
  sendReactionPushNotification,
} from "@repo/messaging"
import type {
  LorRespondJobData,
  RealtimeMessageMention,
} from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  channelRoom,
  threadRoom,
  userRoom,
  workspaceRoom,
} from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import {
  notifyApprovalParked,
  scheduleApprovalEscalation,
} from "@/lib/approval-notify"
import { createProposalCard } from "@/lib/change-proposal"
import { logger } from "@/lib/logger"
import { loadConversation } from "@/lib/lor-conversation"
import { createLoopCard } from "@/lib/lor-loop"
import { postLorMessage } from "@/lib/lor-messages"
import {
  buildApprovalContinuation,
  buildContinuation,
} from "@/lib/run-continuation"
import { noopRunEventWriter } from "@/lib/run-events"
import { drainScopeQueue } from "@/lib/run-queue"
import { updateStreamMentionState } from "@/lib/stream-mentions"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// Matches the worker's createClient (bare RedisClientType mismatches its generics).
type RedisClient = ReturnType<typeof createClient>

// Batch streamed tokens so we publish ~every 24 chars, not per chunk.
const FLUSH_THRESHOLD = 24
// Write-back lock TTL (s); auto-releases if the worker crashes.
const WRITEBACK_LOCK_TTL = 120
// Floor of remaining budget below which the optional write-back is skipped.
const WRITEBACK_MIN_BUDGET_FRACTION = 0.15
const WRITEBACK_MIN_CREDITS = 50

const LOR_ERROR_FALLBACK =
  "I ran into an error answering that. Please try again."

const OUT_OF_CREDITS_MESSAGE =
  "This workspace is out of Lor credits. An admin can top up in Settings → Billing."

export function createLorRespondProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<LorRespondJobData>
) {
  return (job: Job<LorRespondJobData>) =>
    withContext(
      { jobId: job.id, jobName: job.name, channelId: job.data.channelId },
      async () => {
        const {
          lorMessageId,
          channelId,
          threadRootId,
          contextThreadRootId,
          triggerMessageId,
        } = job.data
        logger.info(
          { queueWaitMs: Date.now() - job.timestamp },
          "Lor job picked up"
        )
        const room = threadRootId
          ? threadRoom(threadRootId)
          : channelRoom(channelId)

        // Once this run is terminal, start the follow-up run for anything the
        // scope queued while it was active. Fire-and-forget: draining must
        // never affect the finished run.
        const drainQueue = () => {
          const runId = job.data.runId
          if (!runId) return
          void drainScopeQueue({ runId, emitter, respondQueue }).catch((err) =>
            logger.error({ err, runId }, "Scope queue drain failed")
          )
        }

        // The plan anchored to this run's thread root, when one exists.
        // Mutable: start_plan can create one mid-run, and every settle path
        // below must see it (a const capture would strand it running forever).
        let plan = threadRootId
          ? await db
              .select()
              .from(schema.plan)
              .where(eq(schema.plan.threadRootId, threadRootId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : null
        const emitPlanUpdated = (
          row: typeof schema.plan.$inferSelect,
          meta?: { statusChanged?: boolean }
        ) => {
          emitter
            .to(channelRoom(channelId))
            .emit("plan:updated", { plan: toRealtimePlan(row) })
          // Status moves (waiting/running/terminal) change the sidebar
          // aggregate; step-only updates don't.
          if (meta?.statusChanged) notifyWorkspaceActivity(row.workspaceId)
        }
        // Park the plan when its run ends. `waiting_for_input` only from
        // `running` — completed/waiting_for_approval set by tools stand.
        // `completed` is terminal for every outcome: a failure after
        // complete_plan (fanout, write-back) must never flip a finished plan
        // back to failed.
        let planSettled = false
        let planSettlementOutcome: "complete" | "failed" | "stopped" = "failed"
        const settlePlan = async (
          outcome: "complete" | "failed" | "stopped"
        ) => {
          planSettlementOutcome = outcome
          if (!plan) {
            planSettled = true
            return
          }
          try {
            const fresh = await db
              .select({ status: schema.plan.status, steps: schema.plan.steps })
              .from(schema.plan)
              .where(eq(schema.plan.id, plan.id))
              .limit(1)
              .then((rows) => rows[0])
            if (!fresh) {
              planSettled = true
              return
            }
            const status =
              fresh.status === "completed"
                ? "completed"
                : outcome === "failed"
                  ? "failed"
                  : outcome === "stopped"
                    ? "stopped"
                    : fresh.status === "running"
                      ? "waiting_for_input"
                      : fresh.status
            // Nothing is running once the run settles — demote active plan
            // steps so the card stops showing a spinning step (complete_plan
            // normalizes the plan itself on success).
            const steps =
              status === "completed"
                ? fresh.steps
                : fresh.steps.map((item) =>
                    item.status === "active"
                      ? { ...item, status: "pending" as const }
                      : item
                  )
            // CAS: settle only the state this run observed, and only while
            // the plan is still ours — a fast approval can start a
            // continuation before this run finishes finalizing, and that
            // run's state must not be clobbered.
            const updated = await db
              .update(schema.plan)
              .set({ status, activeRunId: null, steps })
              .where(
                and(
                  eq(schema.plan.id, plan.id),
                  eq(schema.plan.status, fresh.status),
                  job.data.runId
                    ? or(
                        eq(schema.plan.activeRunId, job.data.runId),
                        isNull(schema.plan.activeRunId)
                      )
                    : undefined
                )
              )
              .returning()
              .then((rows) => rows[0])
            planSettled = true
            if (updated)
              emitPlanUpdated(updated, {
                statusChanged: status !== fresh.status,
              })
            else
              logger.warn(
                { planId: plan.id, outcome, observed: fresh.status },
                "Plan settle skipped; status moved under us"
              )
          } catch (err) {
            logger.warn({ err, planId: plan.id }, "Plan settle failed")
            throw err
          }
        }

        // Channel feeds learn about threaded replies only via
        // message:thread:updated — the placeholder emitted one at creation
        // with an empty pending preview, so every settle must broadcast the
        // recomputed summary or channel viewers keep a "thinking" footer
        // until reload (the stream frames go to the thread room only).
        const emitThreadSummary = async () => {
          if (!threadRootId) return
          try {
            const summary = await loadThreadSummary(channelId, threadRootId)
            emitter
              .to(channelRoom(channelId))
              .emit("message:thread:updated", summary)
          } catch (err) {
            logger.warn({ err, threadRootId }, "Thread summary emit failed")
          }
        }

        // Claim the durable run: lease + attempt accounting + event writer.
        // Legacy jobs (no run row) proceed with a no-op writer, exactly as
        // before durable runs existed.
        const claim = await claimAgentRun(job.data.runId, {
          // Live frame for a steer injection — the placeholder chip flips to
          // "applying new direction"; the event log already has the durable copy.
          onSteered: (e) => {
            const steerPayload = {
              channelId,
              threadRootId,
              messageId: lorMessageId,
              steeredMessageId: e.messageId,
              authorName: e.authorName,
              ...(job.data.runId ? { runId: job.data.runId } : {}),
              seq: e.seq,
            }
            emitter.to(room).emit("lor:steer", steerPayload)
          },
        })
        if (claim.kind === "terminal") {
          // Finished by (or currently owned by) another attempt. Still drain:
          // a run settled before it was ever claimed (e.g. stopped while
          // queued) has no other terminal transition to start its queued
          // follow-ups, and draining a still-owned scope is a no-op.
          logger.info(
            { lorMessageId, runId: job.data.runId },
            "Run already terminal or owned elsewhere; skipping"
          )
          // A retry landing after its crashed predecessor's run went terminal
          // (or a stop that raced the claim) is the last actor that can settle
          // the plan — skip only when another attempt still owns a live lease.
          if (job.data.runId) {
            const runState = await db
              .select({ state: schema.agentRun.state })
              .from(schema.agentRun)
              .where(eq(schema.agentRun.id, job.data.runId))
              .then((rows) => rows[0]?.state)
            if (
              runState === "complete" ||
              runState === "failed" ||
              runState === "stopped"
            ) {
              await settlePlan(runState)
              await emitThreadSummary()
            }
          }
          drainQueue()
          return
        }
        const execution = claim.kind === "claimed" ? claim.execution : null
        // Completed plans don't resurrect on follow-up replies — a quick
        // question in a finished plan thread stays a question. Plan tools
        // reopen explicitly (update_plan flips completed back to running).
        if (plan && execution && plan.status !== "completed") {
          const claimedPlan = plan
          await db
            .update(schema.plan)
            .set({ status: "running", activeRunId: job.data.runId ?? null })
            .where(eq(schema.plan.id, claimedPlan.id))
            .returning()
            .then((rows) => {
              const row = rows[0]
              if (row)
                emitPlanUpdated(row, {
                  statusChanged: claimedPlan.status !== "running",
                })
            })
            .catch((err) =>
              logger.warn(
                { err, planId: claimedPlan.id },
                "Plan claim status write failed"
              )
            )
        }
        try {
          const runWriter = execution?.writer ?? noopRunEventWriter
          // Frame fields tying a live socket event to its persisted log entry.
          const runRef = (seq: number | undefined) => ({
            ...(runWriter.runId ? { runId: runWriter.runId } : {}),
            ...(seq !== undefined ? { seq } : {}),
          })
          let streamedContent = ""
          let streamMentionRoster: RealtimeMessageMention[] = []
          runWriter.append({ kind: "state", state: "working" })

          const emit = (
            delta: string,
            done: boolean,
            status?: "complete" | "failed",
            replace?: boolean,
            mentions?: RealtimeMessageMention[]
          ) => {
            const streamState = updateStreamMentionState({
              content: streamedContent,
              delta,
              replace,
              roster: streamMentionRoster,
            })
            streamedContent = streamState.content
            const resolvedMentions =
              mentions && mentions.length > 0 ? mentions : streamState.mentions
            const seq =
              delta || replace
                ? runWriter.append({
                    kind: "text",
                    delta,
                    ...(replace ? { replace: true } : {}),
                  })
                : undefined
            emitter.to(room).emit("message:stream", {
              channelId,
              threadRootId,
              messageId: lorMessageId,
              delta,
              done,
              ...(status ? { status } : {}),
              ...(replace ? { replace: true } : {}),
              ...(resolvedMentions.length > 0 || replace
                ? { mentions: resolvedMentions }
                : {}),
              ...runRef(seq),
            })
          }

          // Register the stream so clients can show a thinking indicator.
          emit("", false)

          if (claim.kind === "exhausted") {
            // Recovery attempts used up — the run can never continue; settle the
            // stuck pending placeholder.
            logger.warn(
              { lorMessageId, runId: job.data.runId },
              "Run out of recovery attempts; failing the message"
            )
            await db
              .update(schema.message)
              .set({ content: LOR_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, lorMessageId))
              .catch(() => {})
            emit(LOR_ERROR_FALLBACK, true, "failed", true)
            await settlePlan("failed")
            await emitThreadSummary()
            drainQueue()
            return
          }

          // Recovered attempt: reset clients to the durable answer prefix — the
          // dead attempt's un-checkpointed tail is discarded by design.
          if (execution?.resume) {
            emit(execution.resume.answerTextSoFar, false, undefined, true)
          }

          // Reasoning is kept both as a legacy aggregate and ordered segments that
          // can be interleaved with tool calls at the same answer-text offset.
          // On recovery, all trails reseed from the event log so the streamed
          // record persisted at the end covers the pre-crash steps too.
          const trail = execution?.resume?.trail
          let reasoning = trail?.reasoning ?? ""
          let pendingReasoning = ""
          let eventOrder = trail?.nextOrder ?? 0
          let activeReasoningSegment: LorReasoningSegment | null = null
          const reasoningSegments: LorReasoningSegment[] = trail
            ? [...trail.reasoningSegments]
            : []
          const flushReasoning = () => {
            if (!pendingReasoning || !activeReasoningSegment) return
            const seq = runWriter.append({
              kind: "reasoning",
              delta: pendingReasoning,
              at: activeReasoningSegment.at,
              order: activeReasoningSegment.order,
            })
            const reasoningPayload = {
              channelId,
              threadRootId,
              messageId: lorMessageId,
              delta: pendingReasoning,
              at: activeReasoningSegment.at,
              order: activeReasoningSegment.order,
              ...runRef(seq),
            }
            emitter.to(room).emit("lor:reasoning", reasoningPayload)
            pendingReasoning = ""
          }
          const closeReasoningSegment = () => {
            flushReasoning()
            activeReasoningSegment = null
          }

          // Phase 1 — generate + stream. On failure, replace the partial text
          // with a fallback.
          let answer: Awaited<ReturnType<typeof respond>>
          let workspaceId: string
          let gateText: string
          // Tools Lor consults while answering — accumulated for the durable
          // trail persisted on the message, and streamed live via lor:tool.
          const toolCalls: LorToolCall[] = trail ? [...trail.toolCalls] : []
          // Brain pages Lor saves (explicit during the answer + autonomous
          // write-back) — accumulated for the durable record and streamed live
          // via lor:memory. Upsert by path (last write wins).
          const remembered: LorMemory[] = trail ? [...trail.remembered] : []
          const remember = (memory: LorMemory) => {
            const idx = remembered.findIndex((m) => m.path === memory.path)
            if (idx >= 0) remembered[idx] = memory
            else remembered.push(memory)
            const seq = runWriter.append({
              kind: "memory",
              path: memory.path,
              action: memory.action,
              ...(memory.nodeId ? { nodeId: memory.nodeId } : {}),
            })
            const memoryPayload = {
              channelId,
              threadRootId,
              messageId: lorMessageId,
              path: memory.path,
              action: memory.action,
              ...(memory.nodeId ? { nodeId: memory.nodeId } : {}),
              ...runRef(seq),
            }
            emitter.to(room).emit("lor:memory", memoryPayload)
          }
          // Point owner/admins at the approval screen the moment a proposal is
          // filed: a workspace-room event pops the in-app alert immediately,
          // and a push covers whoever is away. Neither may fail the answer.
          const notifyInstructionsProposal = (e: {
            version: number
            rationale: string
          }) => {
            emitter
              .to(workspaceRoom(workspaceId))
              .emit("instructions:proposal", {
                workspaceId,
                version: e.version,
              })
            return sendInstructionsProposalPush({ workspaceId, ...e }).catch(
              (err) =>
                logger.error(
                  { err, workspaceId },
                  "Instructions proposal push failed"
                )
            )
          }
          try {
            // Continuation: a follow-up run in a thread/plan scope inherits the
            // previous run's transcript (its tool results and reasoning) rather
            // than rebuilding context from chat text alone, so it resumes the
            // work instead of rediscovering it. Channel scope always builds
            // fresh, and a recovered attempt already has its own transcript.
            // An approval resume is explicit rather than scope-inferred: it
            // replays the parked run named by the approval row, so it also
            // works in a plain channel scope where no delta path exists.
            const continuation = execution?.resume
              ? null
              : job.data.resumeApprovalId
                ? await buildApprovalContinuation({
                    approvalId: job.data.resumeApprovalId,
                  })
                : contextThreadRootId
                  ? await buildContinuation({
                      scopeKey: contextThreadRootId,
                      channelId,
                      lorMessageId,
                      runId: job.data.runId,
                    })
                  : null
            if (continuation && execution) {
              await execution.markContinuedFrom(continuation.predecessorRunId)
            }
            // On recovery the persisted step-0 snapshot is the conversation —
            // reloading would drift (new messages may have landed since). A
            // continued run's snapshot is the delta it was started with.
            const snapshot = execution?.resume
              ? execution.resume
              : continuation
                ? { conversation: continuation.conversation }
                : await loadConversation({
                    channelId,
                    threadRootId: contextThreadRootId,
                    lorMessageId,
                    triggerMessageId,
                  })
            const { conversation } = snapshot
            const backgroundConversation =
              "backgroundConversation" in snapshot
                ? snapshot.backgroundConversation
                : undefined
            // A fresh snapshot covers every pending steer row, so consume them
            // before the first boundary. A continuation delta is bounded and may
            // omit older steers; leave those rows pending rather than sweeping
            // them all as loaded.
            if (execution && !execution.resume && !continuation) {
              await execution.markConversationLoaded()
            }

            const channel = await db
              .select({ workspaceId: schema.channel.workspaceId })
              .from(schema.channel)
              .where(eq(schema.channel.id, channelId))
              .then((r) => r[0])

            // Lor only answers in workspace channels (it's never in a DM).
            if (!channel?.workspaceId) {
              logger.warn(
                { channelId, lorMessageId },
                "Lor invoked outside a workspace channel; skipping"
              )
              await db
                .update(schema.message)
                .set({ content: LOR_ERROR_FALLBACK, status: "failed" })
                .where(eq(schema.message.id, lorMessageId))
                .catch(() => {})
              emit(LOR_ERROR_FALLBACK, true, "failed")
              await runWriter.transition("failed", { stopReason: "error" })
              execution?.stop()
              await settlePlan("failed")
              await emitThreadSummary()
              drainQueue()
              return
            }
            workspaceId = channel.workspaceId
            streamMentionRoster = await db
              .select({
                id: schema.user.id,
                name: schema.user.name,
                image: schema.user.image,
                avatarColor: schema.workspaceMember.avatarColor,
              })
              .from(schema.workspaceMember)
              .innerJoin(
                schema.user,
                eq(schema.workspaceMember.userId, schema.user.id)
              )
              .where(
                and(
                  eq(schema.workspaceMember.workspaceId, workspaceId),
                  ne(schema.user.id, LOR_USER_ID)
                )
              )
              .catch(() => [])

            // Pre-flight credit gate. Autumn failures never land here — the
            // check fails open inside @repo/billing (serve, log, skip debit).
            const gate = await checkCredits(workspaceId)
            if (!gate.allowed) {
              logger.info(
                { workspaceId, lorMessageId },
                "Lor refused; workspace out of credits"
              )
              await db
                .update(schema.message)
                .set({ content: OUT_OF_CREDITS_MESSAGE, status: "failed" })
                .where(eq(schema.message.id, lorMessageId))
                .catch(() => {})
              emit(OUT_OF_CREDITS_MESSAGE, true, "failed")
              await runWriter.transition("failed", {
                stopReason: "out_of_credits",
              })
              execution?.stop()
              await settlePlan("failed")
              await emitThreadSummary()
              drainQueue()
              emitter.to(workspaceRoom(workspaceId)).emit("billing:updated", {
                workspaceId,
                reason: "out_of_credits",
              })
              return
            }

            // Attribution only — never fail the answer over it (and jobs queued
            // before this field existed have no triggerMessageId).
            const triggerUserId = triggerMessageId
              ? await db
                  .select({ authorId: schema.message.authorId })
                  .from(schema.message)
                  .where(eq(schema.message.id, triggerMessageId))
                  .then((r) => r[0]?.authorId ?? null)
                  .catch(() => null)
              : null
            const usageRefs = {
              messageId: lorMessageId,
              channelId,
              userId: triggerUserId,
            }

            // start_plan: adopt this run's thread as a new plan. Posts the
            // projected card into the channel, anchors the plan to the thread
            // root, and assigns it to this run so settlePlan owns it.
            const createPlanForThread = async (input: StartPlanInput) => {
              if (!threadRootId) return null
              const { messageId: cardId } = await postLorMessage(
                { emitter, redis },
                {
                  channelId,
                  content: input.goal,
                  type: "plan_card",
                }
              )
              try {
                const row = await db
                  .insert(schema.plan)
                  .values({
                    workspaceId,
                    channelId,
                    threadRootId,
                    cardMessageId: cardId,
                    creatorId: triggerUserId,
                    title: input.title,
                    goal: input.goal,
                    steps: input.steps,
                    activeRunId: job.data.runId ?? null,
                  })
                  .returning()
                  .then((rows) => rows[0] ?? null)
                if (!row) throw new Error("Plan insert returned no row")
                plan = row
                emitPlanUpdated(row)
                return row
              } catch (err) {
                await db
                  .delete(schema.message)
                  .where(eq(schema.message.id, cardId))
                  .catch(() => {})
                if (isUniqueViolation(err)) {
                  // Lost a race on the thread's unique anchor — adopt the
                  // winner instead of failing the tool call.
                  const existing = await db
                    .select()
                    .from(schema.plan)
                    .where(eq(schema.plan.threadRootId, threadRootId))
                    .limit(1)
                    .then((rows) => rows[0] ?? null)
                  if (existing) {
                    plan = existing
                    return existing
                  }
                }
                logger.error({ err, threadRootId }, "start_plan failed")
                return null
              }
            }

            let pending = ""
            const flushPendingText = () => {
              if (!pending) return
              emit(pending, false)
              pending = ""
            }
            // Loop creator = whoever addressed Lor; null keeps the loop
            // valid when attribution failed (legacy jobs, deleted trigger).
            const proposeLoop: ProposeLoopExecutor = (loopInput) =>
              createLoopCard(
                { emitter, redis },
                {
                  workspaceId,
                  channelId,
                  creatorId: triggerUserId,
                  ...loopInput,
                }
              )
            const proposeChange: ProposeChangeExecutor = (changeInput) =>
              createProposalCard(
                { emitter, redis },
                { workspaceId, channelId, ...changeInput }
              )
            answer = await respond(
              {
                workspaceId,
                conversation,
                backgroundConversation,
                channelId,
                ...(threadRootId ? { threadRootId } : {}),
                triggerMessageId,
                ...(job.data.runId ? { runId: job.data.runId } : {}),
                ...(continuation
                  ? {
                      continuation: {
                        messages: continuation.messages,
                        coveredMessageIds: continuation.coveredMessageIds,
                        deltaText: continuation.deltaText,
                        ...(continuation.approvalResume
                          ? { approvalResume: continuation.approvalResume }
                          : {}),
                        lastInputTokens: continuation.lastInputTokens,
                        compaction: continuation.compaction,
                      },
                    }
                  : {}),
                proposeLoop,
                proposeChange,
                ...(plan
                  ? {
                      plan: {
                        id: plan.id,
                        title: plan.title,
                        goal: plan.goal,
                        status: plan.status,
                        steps: plan.steps,
                        summary: plan.summary,
                      },
                    }
                  : {}),
                ...(threadRootId ? { createPlan: createPlanForThread } : {}),
              },
              {
                onPlanUpdated: emitPlanUpdated,
                notifyWorkspaceActivity,
                onMessageReaction: ({ update, notification }) => {
                  emitter
                    .to(channelRoom(update.channelId))
                    .emit("message:reaction:updated", update)
                  if (!notification) return

                  emitter
                    .to(userRoom(notification.authorUserId))
                    .emit("notification:reaction", notification.payload)

                  void sendReactionPushNotification({
                    authorUserId: notification.authorUserId,
                    notification: notification.payload,
                    redis,
                  }).catch((err) => {
                    logger.error(
                      {
                        err,
                        messageId: update.messageId,
                        userId: notification.authorUserId,
                      },
                      "Lor reaction push failed"
                    )
                  })
                },
                onDelta: (d) => {
                  pending += d
                  if (pending.length >= FLUSH_THRESHOLD) flushPendingText()
                },
                onReasoning: (d, at) => {
                  flushPendingText()
                  if (
                    !activeReasoningSegment ||
                    activeReasoningSegment.at !== at
                  ) {
                    closeReasoningSegment()
                    activeReasoningSegment = {
                      text: "",
                      at,
                      order: eventOrder++,
                    }
                    reasoningSegments.push(activeReasoningSegment)
                  }
                  reasoning += d
                  activeReasoningSegment.text += d
                  pendingReasoning += d
                  if (pendingReasoning.length >= FLUSH_THRESHOLD)
                    flushReasoning()
                },
                // Explicit "remember this" writes happen during the answer; surface
                // their chip immediately like the background write-back does.
                onMemoryWritten: remember,
                // Live tool status ("Searching sources…") streamed so slow tools
                // don't read as a dead spinner; also accumulated for the durable
                // trail persisted below (survives the answer and a reload). Upsert
                // by toolCallId: start sets the label, completion adds detail.
                onToolEvent: (toolCall) => {
                  flushPendingText()
                  const idx = toolCalls.findIndex(
                    (t) => t.toolCallId === toolCall.toolCallId
                  )
                  const existing = idx >= 0 ? toolCalls[idx] : undefined
                  // Frames may be partial updates (streamed sandbox summary,
                  // diffs); one for a row that never got its start frame
                  // can't render — drop it.
                  const base =
                    existing ??
                    (toolCall.toolName && toolCall.label
                      ? { toolName: toolCall.toolName, label: toolCall.label }
                      : undefined)
                  if (!base) return
                  if (!existing && !toolCall.parentToolCallId) {
                    closeReasoningSegment()
                  }
                  const nextToolCall: LorToolCall = {
                    ...base,
                    ...toolCall,
                    ...(existing?.at !== undefined ? { at: existing.at } : {}),
                    ...(existing?.order !== undefined
                      ? { order: existing.order }
                      : !toolCall.parentToolCallId
                        ? { order: eventOrder++ }
                        : {}),
                  }
                  if (idx >= 0) toolCalls[idx] = nextToolCall
                  else toolCalls.push(nextToolCall)
                  const seq = runWriter.append({
                    kind: "tool",
                    toolCall: nextToolCall,
                  })
                  const toolPayload = {
                    channelId,
                    threadRootId,
                    messageId: lorMessageId,
                    toolCall: nextToolCall,
                    ...runRef(seq),
                  }
                  emitter.to(room).emit("lor:tool", toolPayload)
                },
                // Metered usage: every event lands in the usage_event ledger;
                // billable responses and code investigations debit credits.
                // Fire-and-forget: billing must never fail the answer. Nested
                // billable usage also folds into the run's spend counter at the
                // next checkpoint (the budget_spend ceiling).
                onUsage: (u) => {
                  logger.info({ ...u }, "Lor usage")
                  if (
                    u.tool === "investigate_code" ||
                    u.tool === "propose_code_change" ||
                    u.tool === "create_artifacts"
                  )
                    execution?.noteNestedUsage(u)
                  void recordUsage(u, usageRefs)
                },
                onInstructionsProposal: notifyInstructionsProposal,
              },
              execution?.handle
            )
            flushPendingText()
            closeReasoningSegment()

            gateText = `${conversation
              .map((t) => formatSpeakerLine(t.authorName, t.content))
              .join("\n")}\n\nLor: ${answer.text}`
          } catch (err) {
            // Superseded attempt (lease lost / takeover): another worker owns
            // the message now — exit without touching it or emitting anything.
            if (err instanceof LeaseLostError || execution?.aborted()) {
              logger.warn(
                { err, lorMessageId, runId: execution?.runId },
                "Attempt superseded mid-answer; exiting silently"
              )
              execution?.stop()
              return
            }
            logger.error({ err, lorMessageId }, "Lor response failed")
            await db
              .update(schema.message)
              .set({ content: LOR_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, lorMessageId))
              .catch(() => {})
            // Replace (not append) so a partial answer streamed before the error
            // is dropped in favor of the fallback, matching the persisted row.
            emit(LOR_ERROR_FALLBACK, true, "failed", true)
            await runWriter.transition("failed", {
              stopReason:
                execution &&
                Date.now() >= execution.handle.budgets.deadlineAt.getTime()
                  ? "budget_wall_clock"
                  : "error",
            })
            execution?.stop()
            await settlePlan("failed")
            await emitThreadSummary()
            drainQueue()
            return
          }

          // Explicit user stop: keep whatever partial answer streamed, settle
          // the run as stopped, and skip the write-back.
          const stoppedByUser = answer.stoppedFor === "stopped_by_user"
          // Parked on an approval policy: the loop ends the moment the gate
          // trips, so there may be no closing text — the approval card carries
          // the explanation.
          const awaitingApproval = answer.stoppedFor === "awaiting_approval"

          // Phase 2 — persist, then fan out. Persistence decides the terminal
          // status; fanout is best-effort and never downgrades a saved reply.
          await runWriter.transition("finalizing")
          let finalText = ""
          let emptyFallback = false
          // Resolved @mentions from fanout, delivered on the terminal stream frame
          // so the client highlights them live (reload uses the persisted rows).
          let messageMentions: RealtimeMessageMention[] = []
          try {
            // Verify [[…]] citations (brain pages, messages, sources); strip any
            // that don't resolve so a hallucinated source can't masquerade as real
            // (settles on reload), and enrich valid source cites with their url.
            const grounded = await groundCitations(workspaceId, answer.text)
            if (grounded.invalid > 0) {
              logger.warn(
                { lorMessageId, invalid: grounded.invalid },
                "Stripped unresolved Lor citations"
              )
            }

            // Safety net: if generation (and its no-tools retry) still yielded
            // nothing, post a graceful note instead of a blank message that
            // would persist across reloads.
            finalText = grounded.text
            if (!finalText.trim()) {
              finalText = stoppedByUser
                ? "Stopped before I had an answer."
                : awaitingApproval
                  ? "Waiting for approval before I continue."
                  : "I couldn't pull together an answer for that — could you add a bit more detail or rephrase?"
              emptyFallback = true
              if (!stoppedByUser && !awaitingApproval) {
                logger.warn(
                  { lorMessageId },
                  "Lor produced no answer text; using empty fallback"
                )
              }
            }

            // Tool offsets (`at`) were measured against the pre-grounded stream,
            // but we persist the grounded `content` — remap them so the client
            // still splits text/tools correctly on reload. Grounding a prefix
            // rewrites the same tokens as the full pass, so the grounded prefix
            // length is the grounded offset. Citation-free prefixes (the common
            // case — tools run before any cited text) short-circuit with no DB work.
            // Cache the in-flight promise, not the resolved value — the callers
            // below fan out with Promise.all, so same-offset events would each
            // trigger their own grounding pass otherwise.
            const offsetCache = new Map<number, Promise<number>>()
            const remapOffset = (at: number): Promise<number> => {
              if (at <= 0) return Promise.resolve(at)
              const cached = offsetCache.get(at)
              if (cached) return cached
              const mapped = groundCitations(
                workspaceId,
                answer.text.slice(0, at)
              )
                .then((g) => g.text.length)
                .catch(() => at)
              offsetCache.set(at, mapped)
              return mapped
            }
            const persistedToolCalls = emptyFallback
              ? toolCalls
              : await Promise.all(
                  toolCalls.map(async (tc) =>
                    tc.at === undefined
                      ? tc
                      : { ...tc, at: await remapOffset(tc.at) }
                  )
                )
            const persistedReasoningSegments = emptyFallback
              ? reasoningSegments
              : await Promise.all(
                  reasoningSegments.map(async (segment) => ({
                    ...segment,
                    at: await remapOffset(segment.at),
                  }))
                )

            await db
              .update(schema.message)
              .set({
                content: finalText,
                status: "complete",
                lorToolCalls: persistedToolCalls,
                lorReasoning: reasoning || null,
                lorReasoningSegments: persistedReasoningSegments,
                // Explicit "remember this" saves so far; write-back may add more
                // after this and re-persists then.
                lorMemories: remembered,
              })
              .where(eq(schema.message.id, lorMessageId))
          } catch (err) {
            logger.error(
              { err, lorMessageId },
              "Lor reply persistence failed after streaming"
            )
            // The streamed answer was never saved — replace it with the fallback
            // (live and on reload) and stop, so fanout and write-back are skipped
            // for a reply that didn't persist.
            await db
              .update(schema.message)
              .set({ content: LOR_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, lorMessageId))
              .catch(() => {})
            emit(LOR_ERROR_FALLBACK, true, "failed", true)
            await runWriter.transition("failed", { stopReason: "error" })
            execution?.stop()
            await settlePlan("failed")
            await emitThreadSummary()
            drainQueue()
            return
          }

          // Persisted (a failure would have returned above) — fan out
          // unread/mention like a normal message. Best-effort: a fanout failure
          // must not downgrade the reply we already saved.
          try {
            const [channelRow, lorAuthor] = await Promise.all([
              db
                .select({
                  id: schema.channel.id,
                  workspaceId: schema.channel.workspaceId,
                  name: schema.channel.name,
                  workspaceName: schema.workspace.name,
                })
                .from(schema.channel)
                .leftJoin(
                  schema.workspace,
                  eq(schema.workspace.id, schema.channel.workspaceId)
                )
                .where(eq(schema.channel.id, channelId))
                .then((r) => r[0]),
              db
                .select({ name: schema.user.name, image: schema.user.image })
                .from(schema.user)
                .where(eq(schema.user.id, LOR_USER_ID))
                .then((r) => r[0]),
            ])

            if (channelRow) {
              const fanout = await buildMessageFanout({
                authorId: LOR_USER_ID,
                channel: channelRow,
                message: {
                  id: lorMessageId,
                  content: finalText,
                  author: {
                    name: lorAuthor?.name ?? "Lor",
                    image: lorAuthor?.image ?? null,
                  },
                  attachments: [],
                  threadRootId,
                },
                redis,
              })
              messageMentions = fanout.messageMentions
              for (const n of fanout.unreadNotifications) {
                emitter
                  .to(userRoom(n.userId))
                  .emit("notification:unread", n.payload)
              }
              for (const n of fanout.mentionNotifications) {
                emitter
                  .to(userRoom(n.userId))
                  .emit("notification:mention", n.payload)
              }
              void sendMessagePushNotifications({
                fanout,
                redis,
              }).catch((err) => {
                logger.error(
                  { err, lorMessageId },
                  "Push notification send failed"
                )
              })
            }
          } catch (err) {
            logger.error(
              { err, lorMessageId },
              "Lor reply fanout failed after persistence"
            )
          }

          // Normal case streamed the answer already, so just end the stream.
          // For the empty-fallback case nothing was streamed, so push the
          // fallback text as the final delta before ending. Carry the resolved
          // mentions on this terminal frame so the client highlights them live.
          emit(
            emptyFallback ? finalText : "",
            true,
            "complete",
            false,
            messageMentions
          )
          await runWriter.transition(stoppedByUser ? "stopped" : "complete", {
            stopReason: answer.stoppedFor ?? "completed",
          })
          // Heartbeat off: the run is terminal; write-back needs no lease.
          execution?.stop()
          await settlePlan(stoppedByUser ? "stopped" : "complete")
          await emitThreadSummary()
          drainQueue()
          // Announce the gate only after the run is terminal — the resolve
          // endpoint refuses to resume a run that hasn't finished parking.
          // Ids only; cards read the durable row via the approvals query.
          if (awaitingApproval && job.data.runId) {
            const parkedApproval = await db
              .select({
                id: schema.approval.id,
                planId: schema.approval.planId,
              })
              .from(schema.approval)
              .where(
                and(
                  eq(schema.approval.runId, job.data.runId),
                  eq(schema.approval.status, "pending")
                )
              )
              .limit(1)
              .then((r) => r[0] ?? null)
              .catch(() => null)
            if (parkedApproval) {
              emitter.to(channelRoom(channelId)).emit("approval:created", {
                approvalId: parkedApproval.id,
                channelId,
                threadRootId,
                messageId: lorMessageId,
                planId: parkedApproval.planId,
              })
              // Directed fan-out: requester and/or resolvers, per the rules in
              // approval-notify. Never fails the (already terminal) reply.
              try {
                const { scheduleEscalation } = await notifyApprovalParked(
                  { emitter, redis },
                  parkedApproval.id
                )
                if (scheduleEscalation) {
                  await scheduleApprovalEscalation(parkedApproval.id)
                }
              } catch (err) {
                logger.error(
                  { err, approvalId: parkedApproval.id },
                  "Approval notification fan-out failed"
                )
              }
            }
          }
          logger.info(
            { lorMessageId, length: finalText.length, stoppedByUser },
            "Lor reply complete"
          )
          if (stoppedByUser) {
            await runWriter.close()
            return
          }

          // Skip the optional write-back when the answer finished near a
          // ceiling — never endanger an already-delivered response.
          if (execution) {
            const { budgets } = execution.handle
            const c = execution.counters()
            const inputLeft =
              (budgets.inputTokens - c.inputTokens) / budgets.inputTokens
            const outputLeft =
              (budgets.outputTokens - c.outputTokens) / budgets.outputTokens
            const creditsLeft = budgets.credits - c.creditsSpent
            const wallLeftMs = budgets.deadlineAt.getTime() - Date.now()
            if (
              inputLeft < WRITEBACK_MIN_BUDGET_FRACTION ||
              outputLeft < WRITEBACK_MIN_BUDGET_FRACTION ||
              creditsLeft < WRITEBACK_MIN_CREDITS ||
              wallLeftMs < 60_000
            ) {
              logger.info(
                { lorMessageId, runId: execution.runId, counters: c },
                "Write-back skipped; run finished near a budget ceiling"
              )
              await runWriter.close()
              return
            }
            await execution.setPhase("writeback")
          }

          // Phase 3 — autonomous write-back. Per-workspace lock serializes brain
          // writes; skip if another holds it (resurfaces on a later mention).
          const lockKey = `lor:writeback:${workspaceId}`
          const lockToken = randomUUID()
          const acquired = await redis
            .set(lockKey, lockToken, { NX: true, EX: WRITEBACK_LOCK_TTL })
            .catch(() => null)
          if (acquired !== "OK") {
            logger.info(
              { workspaceId, lorMessageId },
              "Write-back skipped; another is in progress"
            )
            return
          }
          try {
            await writeBack(
              {
                workspaceId,
                channelId,
                priorMessages: answer.messages,
                gateText,
              },
              {
                onMemoryWritten: remember,
                // Autonomous — not attributed to the triggering user. Also
                // folded into the run counters (all nested usage counts).
                onUsage: (u) => {
                  execution?.addUsage(u)
                  void recordUsage(u, { messageId: lorMessageId, channelId })
                },
                onInstructionsProposal: notifyInstructionsProposal,
              }
            )
            // Persist what write-back committed so the chip survives a reload
            // (the live emits above only patch the open client's cache).
            if (remembered.length > 0) {
              await db
                .update(schema.message)
                .set({ lorMemories: remembered })
                .where(eq(schema.message.id, lorMessageId))
                .catch((err) =>
                  logger.error(
                    { err, lorMessageId },
                    "Failed to persist Lor memories"
                  )
                )
            }
          } catch (err) {
            logger.error({ err, lorMessageId }, "Lor write-back failed")
          } finally {
            // Release only if we still own it: if write-back outran the TTL and a
            // newer worker re-acquired, an unconditional DEL would drop its lock.
            await redis
              .eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                { keys: [lockKey], arguments: [lockToken] }
              )
              .catch(() => {})
            // Flush any write-back memory events buffered after completion.
            await runWriter.close()
          }
        } catch (err) {
          // A throw escaping every inner handler (statements between the try
          // blocks) would leave the plan running forever — the dead-run sweep
          // fails the run, never the plan. Settle here, then rethrow so BullMQ
          // still records the failure. Lease loss is the exception: the
          // superseding attempt owns the plan's settlement.
          if (!planSettled && !(err instanceof LeaseLostError)) {
            await settlePlan(planSettlementOutcome)
            await emitThreadSummary()
          }
          throw err
        } finally {
          // Heartbeat/stop-signal cleanup for every exit path, including
          // throws outside the inner try blocks (idempotent — most paths
          // already stopped explicitly).
          execution?.stop()
        }
      }
    )
}
