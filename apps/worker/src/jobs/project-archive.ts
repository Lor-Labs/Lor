import { recordUsage } from "@repo/billing"
import { and, asc, db, eq, schema } from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type {
  MerlinMemory,
  MerlinToolCall,
  MerlinToolCallUpdate,
} from "@repo/db/schema"
import { synthesizeProjectArchive } from "@repo/merlin/project-archive"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { ProjectArchiveJobData } from "@repo/realtime-types/queues"
import { channelRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job } from "bullmq"
import { logger } from "@/lib/logger"

// Archive synthesis — the closing half of the project lifecycle. The API
// already locked the channels (archivedAt) and set status "archiving"; this
// job distills the project into workspace-scoped brain pages and stores the
// closing summary + saved-memory list on the project row — the archived
// overview page is the surface, no channel message is posted. Live progress
// (tool calls, memory writes) streams to the category channel room, which the
// overview joins through the normal channel:join access check. The archive
// always completes: a synthesis failure on the final attempt closes without
// a summary rather than stranding the project.
export function createProjectArchiveProcessor(
  emitter: Emitter<ServerToClientEvents>
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
    const categoryChannelId = project.categoryChannelId
    const room = channelRoom(categoryChannelId)

    // Capabilities anchor: the project's first text channel — synthesis gets
    // the same connector reach a run in that channel would.
    const mainChannel = await db
      .select({ id: schema.channel.id })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.parentId, categoryChannelId),
          eq(schema.channel.type, "text")
        )
      )
      .orderBy(asc(schema.channel.position))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    // Tool trail + memory chips: streamed live to whoever is watching the
    // overview; memories are also accumulated for the durable record.
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
      emitter.to(room).emit("project:archive:progress", {
        projectId,
        categoryChannelId,
        toolCall: next,
      })
    }
    const remembered: MerlinMemory[] = []
    const onMemoryWritten = (memory: MerlinMemory) => {
      const idx = remembered.findIndex((m) => m.path === memory.path)
      if (idx >= 0) remembered[idx] = memory
      else remembered.push(memory)
      emitter.to(room).emit("project:archive:progress", {
        projectId,
        categoryChannelId,
        memory,
      })
    }

    let summary: string | null = null
    try {
      const result = await synthesizeProjectArchive(
        {
          workspaceId: project.workspaceId,
          projectId,
          channelId: mainChannel?.id ?? null,
        },
        {
          onToolEvent,
          onMemoryWritten,
          onUsage: (u) => {
            void recordUsage(u, { channelId: categoryChannelId })
          },
        }
      )
      summary = result.summary || null
    } catch (err) {
      logger.error({ err, projectId }, "Archive synthesis failed")
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
      if (!isLastAttempt) throw err
    }

    await db
      .update(schema.project)
      .set({ status: "archived", summary, archiveMemories: remembered })
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.status, "archiving")
        )
      )

    // Flip members' sidebars (archiving spinner → Archived section) and the
    // overview page (progress → summary) live.
    try {
      const userIds = await listChannelAudienceUserIds(categoryChannelId)
      for (const userId of userIds) {
        emitter.to(userRoom(userId)).emit("project:updated", {
          projectId,
          categoryChannelId,
          status: "archived",
          archivedAt: project.archivedAt?.toISOString() ?? null,
        })
      }
    } catch (err) {
      logger.error({ err, projectId }, "project:updated emit failed")
    }
    logger.info({ projectId }, "Project archived")
  }
}
