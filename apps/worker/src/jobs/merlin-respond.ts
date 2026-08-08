import { randomUUID } from "node:crypto"
import { checkCredits, recordUsage } from "@repo/billing"
import {
  and,
  db,
  desc,
  eq,
  isNotNull,
  isNull,
  MERLIN_USER_ID,
  ne,
  notExists,
  or,
  schema,
} from "@repo/db"
import type {
  MerlinMemory,
  MerlinReasoningSegment,
  MerlinToolCall,
} from "@repo/db/schema"
import { withContext } from "@repo/logger"
import {
  groundCitations,
  respond,
  userDisplayName,
  writeBack,
} from "@repo/merlin"
import {
  buildMessageFanout,
  sendInstructionsProposalPush,
  sendMessagePushNotifications,
} from "@repo/messaging"
import type {
  MerlinRespondJobData,
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
import { logger } from "@/lib/logger"
import { noopRunEventWriter } from "@/lib/run-events"
import { drainScopeQueue } from "@/lib/run-queue"
import { updateStreamMentionState } from "@/lib/stream-mentions"

// Matches the worker's createClient (bare RedisClientType mismatches its generics).
type RedisClient = ReturnType<typeof createClient>

// Batch streamed tokens so we publish ~every 24 chars, not per chunk.
const FLUSH_THRESHOLD = 24
const CONTEXT_LIMIT = 30
// Write-back lock TTL (s); auto-releases if the worker crashes.
const WRITEBACK_LOCK_TTL = 120
// Floor of remaining budget below which the optional write-back is skipped.
const WRITEBACK_MIN_BUDGET_FRACTION = 0.15
const WRITEBACK_MIN_CREDITS = 50

const MERLIN_ERROR_FALLBACK =
  "⚠️ I ran into an error answering that. Please try again."

const OUT_OF_CREDITS_MESSAGE =
  "⚠️ This workspace is out of Merlin credits. An admin can top up in Settings → Billing."

// Recent channel/thread messages, oldest→newest; skips the placeholder + empties.
async function loadConversation(args: {
  channelId: string
  threadRootId: string | null
  merlinMessageId: string
}) {
  const scope = args.threadRootId
    ? or(
        eq(schema.message.id, args.threadRootId),
        eq(schema.message.threadRootId, args.threadRootId)
      )
    : and(
        eq(schema.message.channelId, args.channelId),
        isNull(schema.message.threadRootId)
      )

  const rows = await db
    .select({
      content: schema.message.content,
      authorName: schema.user.name,
      authorUsername: schema.user.username,
      authorDisplayUsername: schema.user.displayUsername,
      attachments: schema.message.attachments,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        scope,
        ne(schema.message.id, args.merlinMessageId),
        isNotNull(schema.message.content),
        // Still-queued messages haven't been "sent" yet — each gets its own
        // follow-up run, so they stay out of earlier runs' context (mirrors
        // the clients hiding them from the transcript).
        notExists(
          db
            .select({ id: schema.agentRunQueue.id })
            .from(schema.agentRunQueue)
            .where(
              and(
                eq(schema.agentRunQueue.messageId, schema.message.id),
                eq(schema.agentRunQueue.state, "queued")
              )
            )
        )
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(CONTEXT_LIMIT)

  return rows.reverse().map((r) => {
    const toRef = (a: NonNullable<typeof r.attachments>[number]) => ({
      url: a.url,
      filename: a.filename,
      mediaType: a.contentType,
      size: a.size,
    })
    const images = (r.attachments ?? [])
      .filter((a) => a.contentType.startsWith("image/"))
      .map(toRef)
    const files = (r.attachments ?? [])
      .filter((a) => !a.contentType.startsWith("image/"))
      .map(toRef)
    return {
      authorName: userDisplayName({
        name: r.authorName,
        username: r.authorUsername,
        displayUsername: r.authorDisplayUsername,
      }),
      content: r.content ?? "",
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
    }
  })
}

export function createMerlinRespondProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<MerlinRespondJobData>
) {
  return (job: Job<MerlinRespondJobData>) =>
    withContext(
      { jobId: job.id, jobName: job.name, channelId: job.data.channelId },
      async () => {
        const {
          merlinMessageId,
          channelId,
          threadRootId,
          contextThreadRootId,
          triggerMessageId,
        } = job.data
        logger.info(
          { queueWaitMs: Date.now() - job.timestamp },
          "Merlin job picked up"
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

        // Claim the durable run: lease + attempt accounting + event writer.
        // Legacy jobs (no run row) proceed with a no-op writer, exactly as
        // before durable runs existed.
        const claim = await claimAgentRun(job.data.runId, {
          // Live frame for a steer injection — the placeholder chip flips to
          // "applying new direction"; the event log already has the durable copy.
          onSteered: (e) => {
            emitter.to(room).emit("merlin:steer", {
              channelId,
              threadRootId,
              messageId: merlinMessageId,
              steeredMessageId: e.messageId,
              authorName: e.authorName,
              ...(job.data.runId ? { runId: job.data.runId } : {}),
              seq: e.seq,
            })
          },
        })
        if (claim.kind === "terminal") {
          // Finished by (or currently owned by) another attempt. Still drain:
          // a run settled before it was ever claimed (e.g. stopped while
          // queued) has no other terminal transition to start its queued
          // follow-ups, and draining a still-owned scope is a no-op.
          logger.info(
            { merlinMessageId, runId: job.data.runId },
            "Run already terminal or owned elsewhere; skipping"
          )
          drainQueue()
          return
        }
        const execution = claim.kind === "claimed" ? claim.execution : null
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
              messageId: merlinMessageId,
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
              { merlinMessageId, runId: job.data.runId },
              "Run out of recovery attempts; failing the message"
            )
            await db
              .update(schema.message)
              .set({ content: MERLIN_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, merlinMessageId))
              .catch(() => {})
            emit(MERLIN_ERROR_FALLBACK, true, "failed", true)
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
          let activeReasoningSegment: MerlinReasoningSegment | null = null
          const reasoningSegments: MerlinReasoningSegment[] = trail
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
            emitter.to(room).emit("merlin:reasoning", {
              channelId,
              threadRootId,
              messageId: merlinMessageId,
              delta: pendingReasoning,
              at: activeReasoningSegment.at,
              order: activeReasoningSegment.order,
              ...runRef(seq),
            })
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
          // Tools Merlin consults while answering — accumulated for the durable
          // trail persisted on the message, and streamed live via merlin:tool.
          const toolCalls: MerlinToolCall[] = trail ? [...trail.toolCalls] : []
          // Brain pages Merlin saves (explicit during the answer + autonomous
          // write-back) — accumulated for the durable record and streamed live
          // via merlin:memory. Upsert by path (last write wins).
          const remembered: MerlinMemory[] = trail ? [...trail.remembered] : []
          const remember = (memory: MerlinMemory) => {
            const idx = remembered.findIndex((m) => m.path === memory.path)
            if (idx >= 0) remembered[idx] = memory
            else remembered.push(memory)
            const seq = runWriter.append({
              kind: "memory",
              path: memory.path,
              action: memory.action,
            })
            emitter.to(room).emit("merlin:memory", {
              channelId,
              threadRootId,
              messageId: merlinMessageId,
              path: memory.path,
              action: memory.action,
              ...runRef(seq),
            })
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
            // On recovery the persisted step-0 snapshot is the conversation —
            // reloading would drift (new messages may have landed since).
            const conversation = execution?.resume
              ? execution.resume.conversation
              : await loadConversation({
                  channelId,
                  threadRootId: contextThreadRootId,
                  merlinMessageId,
                })
            // The snapshot covers every steer row that predates it — consume
            // them so the first boundary doesn't inject duplicates.
            if (execution && !execution.resume) {
              await execution.markConversationLoaded()
            }

            const channel = await db
              .select({ workspaceId: schema.channel.workspaceId })
              .from(schema.channel)
              .where(eq(schema.channel.id, channelId))
              .then((r) => r[0])

            // Merlin only answers in workspace channels (it's never in a DM).
            if (!channel?.workspaceId) {
              logger.warn(
                { channelId, merlinMessageId },
                "Merlin invoked outside a workspace channel; skipping"
              )
              await db
                .update(schema.message)
                .set({ content: MERLIN_ERROR_FALLBACK, status: "failed" })
                .where(eq(schema.message.id, merlinMessageId))
                .catch(() => {})
              emit(MERLIN_ERROR_FALLBACK, true, "failed")
              await runWriter.transition("failed", { stopReason: "error" })
              execution?.stop()
              drainQueue()
              return
            }
            workspaceId = channel.workspaceId
            streamMentionRoster = await db
              .select({
                id: schema.user.id,
                name: schema.user.name,
                username: schema.user.username,
                displayUsername: schema.user.displayUsername,
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
                  ne(schema.user.id, MERLIN_USER_ID)
                )
              )
              .catch(() => [])

            // Pre-flight credit gate. Autumn failures never land here — the
            // check fails open inside @repo/billing (serve, log, skip debit).
            const gate = await checkCredits(workspaceId)
            if (!gate.allowed) {
              logger.info(
                { workspaceId, merlinMessageId },
                "Merlin refused; workspace out of credits"
              )
              await db
                .update(schema.message)
                .set({ content: OUT_OF_CREDITS_MESSAGE, status: "failed" })
                .where(eq(schema.message.id, merlinMessageId))
                .catch(() => {})
              emit(OUT_OF_CREDITS_MESSAGE, true, "failed")
              await runWriter.transition("failed", {
                stopReason: "out_of_credits",
              })
              execution?.stop()
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
              messageId: merlinMessageId,
              channelId,
              userId: triggerUserId,
            }

            let pending = ""
            const flushPendingText = () => {
              if (!pending) return
              emit(pending, false)
              pending = ""
            }
            answer = await respond(
              { workspaceId, conversation, channelId },
              {
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
                  if (!existing && !toolCall.parentToolCallId) {
                    closeReasoningSegment()
                  }
                  const nextToolCall: MerlinToolCall = {
                    ...existing,
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
                  emitter.to(room).emit("merlin:tool", {
                    channelId,
                    threadRootId,
                    messageId: merlinMessageId,
                    toolCall: nextToolCall,
                    ...runRef(seq),
                  })
                },
                // Metered usage: every event lands in the usage_event ledger;
                // billable responses and code investigations debit credits.
                // Fire-and-forget: billing must never fail the answer. Nested
                // billable usage also folds into the run's spend counter at the
                // next checkpoint (the budget_spend ceiling).
                onUsage: (u) => {
                  logger.info({ ...u }, "Merlin usage")
                  if (
                    u.tool === "investigate_code" ||
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
              .map((t) => `${t.authorName}: ${t.content}`)
              .join("\n")}\n\nMerlin: ${answer.text}`
          } catch (err) {
            // Superseded attempt (lease lost / takeover): another worker owns
            // the message now — exit without touching it or emitting anything.
            if (err instanceof LeaseLostError || execution?.aborted()) {
              logger.warn(
                { err, merlinMessageId, runId: execution?.runId },
                "Attempt superseded mid-answer; exiting silently"
              )
              execution?.stop()
              return
            }
            logger.error({ err, merlinMessageId }, "Merlin response failed")
            await db
              .update(schema.message)
              .set({ content: MERLIN_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, merlinMessageId))
              .catch(() => {})
            // Replace (not append) so a partial answer streamed before the error
            // is dropped in favor of the fallback, matching the persisted row.
            emit(MERLIN_ERROR_FALLBACK, true, "failed", true)
            await runWriter.transition("failed", {
              stopReason:
                execution &&
                Date.now() >= execution.handle.budgets.deadlineAt.getTime()
                  ? "budget_wall_clock"
                  : "error",
            })
            execution?.stop()
            drainQueue()
            return
          }

          // Explicit user stop: keep whatever partial answer streamed, settle
          // the run as stopped, and skip the write-back.
          const stoppedByUser = answer.stoppedFor === "stopped_by_user"

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
                { merlinMessageId, invalid: grounded.invalid },
                "Stripped unresolved Merlin citations"
              )
            }

            // Safety net: if generation (and its no-tools retry) still yielded
            // nothing, post a graceful note instead of a blank message that
            // would persist across reloads.
            finalText = grounded.text
            if (!finalText.trim()) {
              finalText = stoppedByUser
                ? "⏹️ Stopped before I had an answer."
                : "I couldn't pull together an answer for that — could you add a bit more detail or rephrase?"
              emptyFallback = true
              if (!stoppedByUser) {
                logger.warn(
                  { merlinMessageId },
                  "Merlin produced no answer text; using empty fallback"
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
                merlinToolCalls: persistedToolCalls,
                merlinReasoning: reasoning || null,
                merlinReasoningSegments: persistedReasoningSegments,
                // Explicit "remember this" saves so far; write-back may add more
                // after this and re-persists then.
                merlinMemories: remembered,
              })
              .where(eq(schema.message.id, merlinMessageId))
          } catch (err) {
            logger.error(
              { err, merlinMessageId },
              "Merlin reply persistence failed after streaming"
            )
            // The streamed answer was never saved — replace it with the fallback
            // (live and on reload) and stop, so fanout and write-back are skipped
            // for a reply that didn't persist.
            await db
              .update(schema.message)
              .set({ content: MERLIN_ERROR_FALLBACK, status: "failed" })
              .where(eq(schema.message.id, merlinMessageId))
              .catch(() => {})
            emit(MERLIN_ERROR_FALLBACK, true, "failed", true)
            await runWriter.transition("failed", { stopReason: "error" })
            execution?.stop()
            drainQueue()
            return
          }

          // Persisted (a failure would have returned above) — fan out
          // unread/mention like a normal message. Best-effort: a fanout failure
          // must not downgrade the reply we already saved.
          try {
            const channelRow = await db
              .select({
                id: schema.channel.id,
                workspaceId: schema.channel.workspaceId,
                name: schema.channel.name,
              })
              .from(schema.channel)
              .where(eq(schema.channel.id, channelId))
              .then((r) => r[0])

            if (channelRow) {
              const fanout = await buildMessageFanout({
                authorId: MERLIN_USER_ID,
                channel: channelRow,
                message: {
                  id: merlinMessageId,
                  content: finalText,
                  author: { name: "Merlin" },
                  attachments: [],
                },
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
                threadRootId,
                redis,
              }).catch((err) => {
                logger.error(
                  { err, merlinMessageId },
                  "Push notification send failed"
                )
              })
            }
          } catch (err) {
            logger.error(
              { err, merlinMessageId },
              "Merlin reply fanout failed after persistence"
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
          drainQueue()
          logger.info(
            { merlinMessageId, length: finalText.length, stoppedByUser },
            "Merlin reply complete"
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
                { merlinMessageId, runId: execution.runId, counters: c },
                "Write-back skipped; run finished near a budget ceiling"
              )
              await runWriter.close()
              return
            }
            await execution.setPhase("writeback")
          }

          // Phase 3 — autonomous write-back. Per-workspace lock serializes brain
          // writes; skip if another holds it (resurfaces on a later mention).
          const lockKey = `merlin:writeback:${workspaceId}`
          const lockToken = randomUUID()
          const acquired = await redis
            .set(lockKey, lockToken, { NX: true, EX: WRITEBACK_LOCK_TTL })
            .catch(() => null)
          if (acquired !== "OK") {
            logger.info(
              { workspaceId, merlinMessageId },
              "Write-back skipped; another is in progress"
            )
            return
          }
          try {
            await writeBack(
              { workspaceId, priorMessages: answer.messages, gateText },
              {
                onMemoryWritten: remember,
                // Autonomous — not attributed to the triggering user. Also
                // folded into the run counters (all nested usage counts).
                onUsage: (u) => {
                  execution?.addUsage(u)
                  void recordUsage(u, { messageId: merlinMessageId, channelId })
                },
                onInstructionsProposal: notifyInstructionsProposal,
              }
            )
            // Persist what write-back committed so the chip survives a reload
            // (the live emits above only patch the open client's cache).
            if (remembered.length > 0) {
              await db
                .update(schema.message)
                .set({ merlinMemories: remembered })
                .where(eq(schema.message.id, merlinMessageId))
                .catch((err) =>
                  logger.error(
                    { err, merlinMessageId },
                    "Failed to persist Merlin memories"
                  )
                )
            }
          } catch (err) {
            logger.error({ err, merlinMessageId }, "Merlin write-back failed")
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
        } finally {
          // Heartbeat/stop-signal cleanup for every exit path, including
          // throws outside the inner try blocks (idempotent — most paths
          // already stopped explicitly).
          execution?.stop()
        }
      }
    )
}
