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
// threadRootId = where the reply is posted (Lor's chosen placement).
// contextThreadRootId = where the trigger lived (null = main channel); the
// worker reads conversation context from here, which differs from threadRootId
// when Lor routes a channel mention into a fresh thread.
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
