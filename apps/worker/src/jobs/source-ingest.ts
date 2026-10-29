import { recordUsage } from "@repo/billing"
import { db, eq, schema } from "@repo/db"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { withContext } from "@repo/logger"
import { isIngestedProvider, SOURCE_FETCHERS } from "@repo/lor/providers"
import { storeSourceItem, tombstoneSource } from "@repo/lor/sources"
import type { SourceIngestJobData } from "@repo/realtime-types/queues"
import type { Job } from "bullmq"

// Refetches one item and stores its text. A transient provider failure
// throws, so BullMQ retries with backoff.
// reference/planned/context-engine-phase-2.md Step 3.
export function createSourceIngestProcessor() {
  return (job: Job<SourceIngestJobData>) =>
    withContext({ jobId: job.id, jobName: job.name }, async () => {
      const { connectionId, kind, ref } = job.data
      const connection = await db
        .select({
          id: schema.integrationConnection.id,
          workspaceId: schema.integrationConnection.workspaceId,
          provider: schema.integrationConnection.provider,
          externalId: schema.integrationConnection.externalId,
          status: schema.integrationConnection.status,
        })
        .from(schema.integrationConnection)
        .where(eq(schema.integrationConnection.id, connectionId))
        .limit(1)
        .then((rows) => rows[0])
      if (
        !connection ||
        connection.status !== "active" ||
        !isIngestedProvider(connection.provider)
      ) {
        return
      }

      if (
        (await workspaceBetaAccess(connection.workspaceId)).state !== "active"
      )
        return
      const fetched = await SOURCE_FETCHERS[connection.provider](
        connection,
        kind,
        ref
      )
      for (const key of fetched.gone) {
        await tombstoneSource(connection.id, key)
      }
      if (!fetched.item) return

      // Metered at true cost, never debited, like attachment indexing. The
      // job settles only after its usage rows are written.
      const recorded: Promise<void>[] = []
      try {
        await storeSourceItem(connection, fetched.item, (u) => {
          recorded.push(recordUsage(u))
        })
      } finally {
        await Promise.allSettled(recorded)
      }
    })
}
