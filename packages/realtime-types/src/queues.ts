export const LINK_UNFURL_QUEUE = "link-unfurl"

export type LinkUnfurlJobData = {
  messageId: string
  channelId: string
  threadRootId?: string | null
  urls: string[]
}

export const LOR_RESPOND_QUEUE = "lor-respond"

// Redis pub/sub channel for immediate run stops: the API publishes the runId,
// the worker holding the lease aborts the in-flight model request. The
// stopRequestedAt flag (heartbeat/checkpoint) remains the durable fallback.
export const AGENT_RUN_STOP_CHANNEL = "agent-run:stop"

// lorMessageId = the empty placeholder message the worker streams into.
// threadRootId = where the reply is posted (the session's thread).
// contextThreadRootId = where the trigger lived (null = main channel); the
// worker reads conversation context from here.
export type LorRespondJobData = {
  lorMessageId: string
  channelId: string
  threadRootId: string | null
  contextThreadRootId: string | null
  triggerMessageId: string
  // Durable agent_run row backing this job. Optional only for jobs enqueued
  // before the run table existed; new jobs always carry it.
  runId?: string
  // Set when a resolved approval started this run (LOR-81): the run resumes
  // the parked run's transcript and answers its tool-approval request instead
  // of building a delta. Works in any scope, including plain channel runs.
  resumeApprovalId?: string
}

// Headless triggered runs (the Act effect — reference/automation-primitives.md
// §2). The run row carries provenance (triggerId/deliveryId); the job carries
// the normalized inbound payload since first-party event content isn't stored.
export const TRIGGERED_RUN_QUEUE = "triggered-run"

// Job names on that queue: one prepared run, or a window flush that builds the
// run from the deliveries it collected (reference/automation-primitives.md §5).
export const ACT_RUN_JOB = "act"
export const ACT_FLUSH_JOB = "act-flush"

export type TriggeredRunJobData = {
  runId: string
  // Normalized event payload, composed at dispatch — the run's user turn.
  payload: string
  // Event source label (connector + event, or the webhook's name).
  label: string
}

// The delayed flush: the trigger owns the open window, so the job needs
// nothing else. Deliberately has no jobId — `connector_trigger`.
// `act_window_opened_at` is the dedupe, not Redis.
export type ActFlushJobData = { triggerId: string }

// Scheduled loop runs (reference/loops.md). Dedicated queue — fairness
// isolation from Act webhook bursts, independent scaling later. The job is
// deliberately thin: the processor re-reads the loop row for the kill switch
// and prompt inputs, and the run row carries provenance (loopId/scheduledFor).
export const LOOP_RUN_QUEUE = "loop-run"
export const LOOP_RUN_JOB = "loop"

export type LoopRunJobData = {
  runId: string
  loopId: string
}

// Requests to Lor spoken in a call (reference/voice-channels-runbook.md V5).
// The transcriber enqueues an accepted request; the worker creates its run.
export const VOICE_REQUEST_QUEUE = "voice-request"
export const VOICE_REQUEST_JOB = "voice"

// `resumeApprovalId`: continue a request paused on that approval, now
// resolved.
export type VoiceRequestJobData = {
  requestId: string
  resumeApprovalId?: string
}

// After a call ends: summarize it and index its passages for Lor's search.
// Queued by whichever host ended the call, and by the voice audit as a
// backstop; the fixed id keeps a call from running twice at once.
export const VOICE_SESSION_MEMORY_JOB = "voice-session-memory"
export type VoiceSessionMemoryJobData = { sessionId: string }
export function voiceSessionMemoryJob(sessionId: string) {
  return {
    name: VOICE_SESSION_MEMORY_JOB,
    data: { sessionId } satisfies VoiceSessionMemoryJobData,
    opts: {
      // BullMQ rejects ":" in custom ids.
      jobId: `memory-${sessionId}`,
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: { age: 86_400 },
    },
  }
}

// Checks a paused request's approvers every few seconds, and rejects the
// approval once nobody in the call can resolve it for the grace period.
export const VOICE_APPROVAL_WATCH_JOB = "approval-watch"
export type VoiceApprovalWatchJobData = {
  requestId: string
  approvalId: string
  // When the last approver was found missing; null while one is present.
  missingSince: number | null
}

// Project archive synthesis: the API flips the project to `archiving` (write
// locks engage immediately), then this job distills the project into
// workspace-scoped brain pages, posts a closing summary, and marks it
// `archived`.
export const PROJECT_ARCHIVE_QUEUE = "project-archive"

export type ProjectArchiveJobData = { projectId: string }

// Attachment indexing (reference/attachment-search.md): transcribes and
// embeds a message's attachments after send. Never enqueued for DMs.
export const ATTACHMENT_INDEX_QUEUE = "attachment-index"

export type AttachmentIndexJobData = { messageId: string; channelId: string }
