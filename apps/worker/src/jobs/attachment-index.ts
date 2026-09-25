import { recordUsage } from "@repo/billing"
import { withContext } from "@repo/logger"
import { indexMessageAttachments } from "@repo/lor/attachments"
import type { AttachmentIndexJobData } from "@repo/realtime-types/queues"
import type { Job } from "bullmq"

export function createAttachmentIndexProcessor() {
  return (job: Job<AttachmentIndexJobData>) =>
    withContext(
      { jobId: job.id, jobName: job.name, channelId: job.data.channelId },
      () => {
        const { messageId, channelId } = job.data
        // Metered at true cost, never debited, like connector ingestion.
        return indexMessageAttachments(messageId, (u) => {
          void recordUsage(u, { messageId, channelId })
        })
      }
    )
}
