import { randomUUID } from "node:crypto"
import {
  and,
  db,
  desc,
  eq,
  isNotNull,
  isNull,
  MERLIN_USER_ID,
  ne,
  or,
  schema,
} from "@repo/db"
import type { MerlinMemory, MerlinToolCall } from "@repo/db/schema"
import { withContext } from "@repo/logger"
import { groundCitations, respond, writeBack } from "@repo/merlin"
import { buildMessageFanout } from "@repo/messaging"
import type { MerlinRespondJobData } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"

// Matches the worker's createClient (bare RedisClientType mismatches its generics).
type RedisClient = ReturnType<typeof createClient>

// Batch streamed tokens so we publish ~every 24 chars, not per chunk.
const FLUSH_THRESHOLD = 24
const CONTEXT_LIMIT = 30
// Write-back lock TTL (s); auto-releases if the worker crashes.
const WRITEBACK_LOCK_TTL = 120

const MERLIN_ERROR_FALLBACK =
  "⚠️ I ran into an error answering that. Please try again."

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
      attachments: schema.message.attachments,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        scope,
        ne(schema.message.id, args.merlinMessageId),
        isNotNull(schema.message.content)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(CONTEXT_LIMIT)

  return rows.reverse().map((r) => {
    const images = (r.attachments ?? [])
      .filter((a) => a.contentType.startsWith("image/"))
      .map((a) => ({
        url: a.url,
        filename: a.filename,
        mediaType: a.contentType,
        size: a.size,
      }))
    return {
      authorName: r.authorName,
      content: r.content ?? "",
      ...(images.length > 0 ? { images } : {}),
    }
  })
}

export function createMerlinRespondProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient
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
        } = job.data
        const room = threadRootId
          ? threadRoom(threadRootId)
          : channelRoom(channelId)

        const emit = (
          delta: string,
          done: boolean,
          status?: "complete" | "failed",
          replace?: boolean
        ) =>
          emitter.to(room).emit("message:stream", {
            channelId,
            threadRootId,
            messageId: merlinMessageId,
            delta,
            done,
            ...(status ? { status } : {}),
            ...(replace ? { replace: true } : {}),
          })

        // Register the stream so clients can show a thinking indicator.
        emit("", false)

        // Summarized thinking, accumulated for persistence + batched to clients.
        let reasoning = ""
        let pendingReasoning = ""
        const flushReasoning = () => {
          if (!pendingReasoning) return
          emitter.to(room).emit("merlin:reasoning", {
            channelId,
            threadRootId,
            messageId: merlinMessageId,
            delta: pendingReasoning,
          })
          pendingReasoning = ""
        }

        // Phase 1 — generate + stream. On failure, replace the partial text
        // with a fallback.
        let answer: Awaited<ReturnType<typeof respond>>
        let workspaceId: string
        let gateText: string
        // Tools Merlin consults while answering — accumulated for the durable
        // trail persisted on the message, and streamed live via merlin:tool.
        const toolCalls: MerlinToolCall[] = []
        // Brain pages Merlin saves (explicit during the answer + autonomous
        // write-back) — accumulated for the durable record and streamed live
        // via merlin:memory. Upsert by path (last write wins).
        const remembered: MerlinMemory[] = []
        const remember = (memory: MerlinMemory) => {
          const idx = remembered.findIndex((m) => m.path === memory.path)
          if (idx >= 0) remembered[idx] = memory
          else remembered.push(memory)
          emitter.to(room).emit("merlin:memory", {
            channelId,
            threadRootId,
            messageId: merlinMessageId,
            path: memory.path,
            action: memory.action,
          })
        }
        try {
          const conversation = await loadConversation({
            channelId,
            threadRootId: contextThreadRootId,
            merlinMessageId,
          })

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
            return
          }
          workspaceId = channel.workspaceId

          let pending = ""
          answer = await respond(
            { workspaceId, conversation, channelId },
            {
              onDelta: (d) => {
                pending += d
                if (pending.length >= FLUSH_THRESHOLD) {
                  emit(pending, false)
                  pending = ""
                }
              },
              onReasoning: (d) => {
                reasoning += d
                pendingReasoning += d
                if (pendingReasoning.length >= FLUSH_THRESHOLD) flushReasoning()
              },
              // Explicit "remember this" writes happen during the answer; surface
              // their chip immediately like the background write-back does.
              onMemoryWritten: remember,
              // Live tool status ("Searching sources…") streamed so slow tools
              // don't read as a dead spinner; also accumulated for the durable
              // trail persisted below (survives the answer and a reload). Upsert
              // by toolCallId: start sets the label, completion adds detail.
              onToolEvent: (toolCall) => {
                const idx = toolCalls.findIndex(
                  (t) => t.toolCallId === toolCall.toolCallId
                )
                if (idx >= 0) toolCalls[idx] = toolCall
                else toolCalls.push(toolCall)
                emitter.to(room).emit("merlin:tool", {
                  channelId,
                  threadRootId,
                  messageId: merlinMessageId,
                  toolCall,
                })
              },
              // Metered tool usage (e.g. the code sandbox agent). No billing yet —
              // log it; this is the seam to persist a usage row + report to Stripe.
              onUsage: (u) => logger.info({ ...u }, "Merlin tool usage"),
            }
          )
          if (pending.length > 0) emit(pending, false)
          flushReasoning()

          gateText = `${conversation
            .map((t) => `${t.authorName}: ${t.content}`)
            .join("\n")}\n\nMerlin: ${answer.text}`
        } catch (err) {
          logger.error({ err, merlinMessageId }, "Merlin response failed")
          await db
            .update(schema.message)
            .set({ content: MERLIN_ERROR_FALLBACK, status: "failed" })
            .where(eq(schema.message.id, merlinMessageId))
            .catch(() => {})
          // Replace (not append) so a partial answer streamed before the error
          // is dropped in favor of the fallback, matching the persisted row.
          emit(MERLIN_ERROR_FALLBACK, true, "failed", true)
          return
        }

        // Phase 2 — persist, then fan out. Persistence decides the terminal
        // status; fanout is best-effort and never downgrades a saved reply.
        let finalText = ""
        let emptyFallback = false
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
            finalText =
              "I couldn't pull together an answer for that — could you add a bit more detail or rephrase?"
            emptyFallback = true
            logger.warn(
              { merlinMessageId },
              "Merlin produced no answer text; using empty fallback"
            )
          }

          // Tool offsets (`at`) were measured against the pre-grounded stream,
          // but we persist the grounded `content` — remap them so the client
          // still splits text/tools correctly on reload. Grounding a prefix
          // rewrites the same tokens as the full pass, so the grounded prefix
          // length is the grounded offset. Citation-free prefixes (the common
          // case — tools run before any cited text) short-circuit with no DB work.
          const offsetCache = new Map<number, number>()
          const remapOffset = async (at: number): Promise<number> => {
            if (at <= 0) return at
            const cached = offsetCache.get(at)
            if (cached !== undefined) return cached
            const g = await groundCitations(
              workspaceId,
              answer.text.slice(0, at)
            ).catch(() => null)
            const mapped = g ? g.text.length : at
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

          await db
            .update(schema.message)
            .set({
              content: finalText,
              status: "complete",
              merlinToolCalls: persistedToolCalls,
              merlinReasoning: reasoning || null,
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
          }
        } catch (err) {
          logger.error(
            { err, merlinMessageId },
            "Merlin reply fanout failed after persistence"
          )
        }

        // Normal case streamed the answer already, so just end the stream.
        // For the empty-fallback case nothing was streamed, so push the
        // fallback text as the final delta before ending.
        emit(emptyFallback ? finalText : "", true, "complete")
        logger.info(
          { merlinMessageId, length: finalText.length },
          "Merlin reply complete"
        )

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
            { onMemoryWritten: remember }
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
        }
      }
    )
}
