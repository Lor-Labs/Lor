import { recordUsage } from "@repo/billing"
import { and, asc, db, eq, isNull, MERLIN_USER_ID, schema } from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type {
  MerlinMemory,
  MerlinToolCall,
  MerlinToolCallUpdate,
} from "@repo/db/schema"
import { synthesizeProjectArchive } from "@repo/merlin/project-archive"
import type { RealtimeMessage } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { ProjectArchiveJobData } from "@repo/realtime-types/queues"
import { channelRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { fanoutMerlinMessage, loadMerlinAuthor } from "@/lib/merlin-messages"

type RedisClient = ReturnType<typeof createClient>

const SYNTHESIS_FALLBACK =
  "This project has been archived. I couldn't put together a closing summary this time — the channels remain readable."

// Archive synthesis — the closing half of the project lifecycle. The API
// already locked the channels (archivedAt) and set status "archiving"; this
// job posts a pending Merlin message in the project's first channel, streams
// tool/memory events against it while it distills the project (the live
// "what is it doing" surface), fills it with the closing summary, and flips
// the project to "archived". The archive always completes: a synthesis
// failure on the final attempt falls back to a summary-less close rather
// than stranding the project.
export function createProjectArchiveProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient
) {
  return async (job: Job<ProjectArchiveJobData>) => {
    const { projectId } = job.data

    const project = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .limit(1)
      .then((rows) => rows[0])
    if (!project) {
      logger.warn({ projectId }, "Archive job for missing project")
      return
    }
    if (project.status !== "archiving") {
      logger.info(
        { projectId, status: project.status },
        "Archive job skipped: project not archiving"
      )
      return
    }

    const finalizeProject = async (input: {
      summary: string | null
      closingMessageId: string | null
    }) => {
      await db
        .update(schema.project)
        .set({
          status: "archived",
          summary: input.summary,
          closingMessageId: input.closingMessageId,
        })
        .where(
          and(
            eq(schema.project.id, projectId),
            eq(schema.project.status, "archiving")
          )
        )
      // Flip members' sidebars (archiving spinner → Archived section) live.
      try {
        const userIds = await listChannelAudienceUserIds(
          project.categoryChannelId
        )
        for (const userId of userIds) {
          emitter.to(userRoom(userId)).emit("project:updated", {
            projectId,
            categoryChannelId: project.categoryChannelId,
            status: "archived",
            archivedAt: project.archivedAt?.toISOString() ?? null,
          })
        }
      } catch (err) {
        logger.error({ err, projectId }, "project:updated emit failed")
      }
      logger.info({ projectId }, "Project archived")
    }

    const mainChannel = await db
      .select({ id: schema.channel.id })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.parentId, project.categoryChannelId),
          eq(schema.channel.type, "text")
        )
      )
      .orderBy(asc(schema.channel.position))
      .limit(1)
      .then((rows) => rows[0])
    if (!mainChannel) {
      // Nothing to summarize into — close the lifecycle anyway.
      await finalizeProject({ summary: null, closingMessageId: null })
      return
    }
    const channelId = mainChannel.id

    // Reuse a pending placeholder from a crashed prior attempt so retries
    // never stack thinking indicators in the channel.
    const existingPlaceholder = await db
      .select({ id: schema.message.id, createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.channelId, channelId),
          eq(schema.message.authorId, MERLIN_USER_ID),
          eq(schema.message.status, "pending"),
          isNull(schema.message.threadRootId)
        )
      )
      .orderBy(asc(schema.message.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const placeholder =
      existingPlaceholder ??
      (await db
        .insert(schema.message)
        .values({
          channelId,
          authorId: MERLIN_USER_ID,
          status: "pending",
        })
        .returning({
          id: schema.message.id,
          createdAt: schema.message.createdAt,
        })
        .then((rows) => rows[0]))
    if (!placeholder) throw new Error("Placeholder insert returned no row")
    const messageId = placeholder.id

    if (!existingPlaceholder) {
      const author = await loadMerlinAuthor().catch(() => null)
      if (author) {
        const message: RealtimeMessage = {
          id: messageId,
          channelId,
          content: null,
          type: "default",
          pinned: false,
          createdAt: placeholder.createdAt.toISOString(),
          author: { ...author, avatarColor: null },
          mentions: [],
          reactions: [],
          attachments: [],
          embeds: [],
          referencedMessage: null,
          threadRootId: null,
          status: "pending",
          streaming: true,
        }
        emitter.to(channelRoom(channelId)).emit("message:created", message)
      }
    }

    // Tool trail + memory chips, accumulated for the durable record on the
    // message and streamed live — same shapes merlin-respond emits, minus the
    // run id (no run row, so no replay; reload shows the persisted result).
    let eventOrder = 0
    const toolCalls: MerlinToolCall[] = []
    const onToolEvent = (toolCall: MerlinToolCallUpdate) => {
      const idx = toolCalls.findIndex(
        (t) => t.toolCallId === toolCall.toolCallId
      )
      const existing = idx >= 0 ? toolCalls[idx] : undefined
      const base =
        existing ??
        (toolCall.toolName && toolCall.label
          ? { toolName: toolCall.toolName, label: toolCall.label }
          : undefined)
      if (!base) return
      const next: MerlinToolCall = {
        ...base,
        ...toolCall,
        ...(existing?.order !== undefined
          ? { order: existing.order }
          : !toolCall.parentToolCallId
            ? { order: eventOrder++ }
            : {}),
      }
      if (idx >= 0) toolCalls[idx] = next
      else toolCalls.push(next)
      emitter.to(channelRoom(channelId)).emit("merlin:tool", {
        channelId,
        threadRootId: null,
        messageId,
        toolCall: next,
      })
    }
    const remembered: MerlinMemory[] = []
    const onMemoryWritten = (memory: MerlinMemory) => {
      const idx = remembered.findIndex((m) => m.path === memory.path)
      if (idx >= 0) remembered[idx] = memory
      else remembered.push(memory)
      emitter.to(channelRoom(channelId)).emit("merlin:memory", {
        channelId,
        threadRootId: null,
        messageId,
        path: memory.path,
        action: memory.action,
      })
    }

    let summary: string | null = null
    try {
      const result = await synthesizeProjectArchive(
        { workspaceId: project.workspaceId, projectId, channelId },
        {
          onToolEvent,
          onMemoryWritten,
          onUsage: (u) => {
            void recordUsage(u, { messageId, channelId })
          },
        }
      )
      summary = result.summary || null
    } catch (err) {
      logger.error({ err, projectId }, "Archive synthesis failed")
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
      if (!isLastAttempt) {
        // Retract the placeholder so the retry starts clean, then let BullMQ
        // reschedule the job.
        await db
          .delete(schema.message)
          .where(eq(schema.message.id, messageId))
          .catch(() => {})
        emitter.to(channelRoom(channelId)).emit("message:deleted", {
          channelId,
          messageId,
        })
        throw err
      }
    }

    // Finalize the message: content lands in one terminal stream frame (no
    // deltas were sent), clearing the pending state live and on reload.
    const finalText = summary ?? SYNTHESIS_FALLBACK
    await db
      .update(schema.message)
      .set({
        content: finalText,
        status: "complete",
        merlinToolCalls: toolCalls,
        merlinMemories: remembered,
      })
      .where(eq(schema.message.id, messageId))
    emitter.to(channelRoom(channelId)).emit("message:stream", {
      channelId,
      threadRootId: null,
      messageId,
      delta: finalText,
      done: true,
      status: "complete",
      replace: true,
    })
    await fanoutMerlinMessage(
      { emitter, redis },
      { channelId, messageId, content: finalText }
    )

    await finalizeProject({ summary, closingMessageId: messageId })
  }
}
