import { recordUsage } from "@repo/billing"
import { and, asc, db, eq, schema } from "@repo/db"
import { synthesizeProjectArchive } from "@repo/merlin/project-archive"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { ProjectArchiveJobData } from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postMerlinMessage } from "@/lib/merlin-messages"

type RedisClient = ReturnType<typeof createClient>

// Archive synthesis — the closing half of the project lifecycle. The API
// already locked the channels (archivedAt) and set status "archiving"; this
// job distills the project into workspace-scoped brain pages, posts Merlin's
// closing summary in the project's first channel, and flips the project to
// "archived". Retries re-run synthesis (page writes are upserts by path); the
// status gate keeps completed projects from re-running.
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

    let summary: string | null = null
    try {
      const result = await synthesizeProjectArchive({
        workspaceId: project.workspaceId,
        projectId,
        onUsage: (u) => {
          void recordUsage(u)
        },
        onMemoryWritten: (e) => {
          logger.info({ projectId, ...e }, "Archive synthesis wrote memory")
        },
      })
      summary = result.summary || null
    } catch (err) {
      logger.error({ err, projectId }, "Archive synthesis failed")
      throw err
    }

    if (summary) {
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
      if (mainChannel) {
        await postMerlinMessage(
          { emitter, redis },
          { channelId: mainChannel.id, content: summary }
        ).catch((err) => {
          // The synthesis (the durable part) succeeded — don't fail/retry the
          // job over the closing message.
          logger.error({ err, projectId }, "Archive closing post failed")
        })
      }
    }

    await db
      .update(schema.project)
      .set({ status: "archived" })
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.status, "archiving")
        )
      )
    logger.info({ projectId }, "Project archived")
  }
}
