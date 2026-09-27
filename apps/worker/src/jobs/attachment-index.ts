import { recordUsage } from "@repo/billing"
import { withContext } from "@repo/logger"
import { indexMessageAttachments } from "@repo/lor/attachments"
import type { AttachmentIndexJobData } from "@repo/realtime-types/queues"
import type { Job } from "bullmq"

export function createAttachmentIndexProcessor() {
  return (job: Job<AttachmentIndexJobData>) =>
    withContext(
      { jobId: job.id, jobName: job.name, channelId: job.data.channelId },
      async () => {
        const { messageId, channelId } = job.data
        // Metered at true cost, never debited, like connector ingestion. The
        // job settles only after its usage rows are written, even on failure.
        const recorded: Promise<void>[] = []
        try {
          await indexMessageAttachments(messageId, (u) => {
            recorded.push(recordUsage(u, { messageId, channelId }))
          })
        } finally {
          await Promise.allSettled(recorded)
        }
      }
    )
}
