export const LINK_UNFURL_QUEUE = "link-unfurl"

export type LinkUnfurlJobData = {
  messageId: string
  channelId: string
  urls: string[]
}

export const MERLIN_RESPOND_QUEUE = "merlin-respond"

// Redis pub/sub channel for immediate run stops: the API publishes the runId,
// the worker holding the lease aborts the in-flight model request. The
// stopRequestedAt flag (heartbeat/checkpoint) remains the durable fallback.
export const AGENT_RUN_STOP_CHANNEL = "agent-run:stop"

// merlinMessageId = the empty placeholder message the worker streams into.
// threadRootId = where the reply is posted (Merlin's chosen placement).
// contextThreadRootId = where the trigger lived (null = main channel); the
// worker reads conversation context from here, which differs from threadRootId
// when Merlin routes a channel mention into a fresh thread.
export type MerlinRespondJobData = {
  merlinMessageId: string
  channelId: string
  threadRootId: string | null
  contextThreadRootId: string | null
  triggerMessageId: string
  // Durable agent_run row backing this job. Optional only for jobs enqueued
  // before the run table existed; new jobs always carry it.
  runId?: string
}

// Headless triggered runs (the Act effect — reference/automation-primitives.md
// §2). The run row carries provenance (triggerId/deliveryId); the job carries
// the normalized inbound payload since first-party event content isn't stored.
export const TRIGGERED_RUN_QUEUE = "triggered-run"

export type TriggeredRunJobData = {
  runId: string
  // Normalized event payload, composed at dispatch — the run's user turn.
  payload: string
  // Event source label (connector + event, or the webhook's name).
  label: string
}
