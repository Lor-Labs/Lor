import type { RealtimeMessageMention } from "@repo/realtime-types"
import {
  appendReasoningSegment,
  type MerlinReasoningSegment,
  upsertToolCall,
} from "@repo/utils/merlin"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { apiClient } from "@/lib/api-client"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import type { AppSocket } from "@/lib/socket"

type ToolCall = {
  toolCallId: string
  toolName: string
  label: string
  at?: number
  order?: number
  parentToolCallId?: string
  detail?: { summary?: string; items?: { title: string; url?: string }[] }
  diff?: {
    path: string
    additions: number
    deletions: number
    patch?: string
    truncated?: boolean
  }
  status?: "ok" | "error"
}

interface MessagePage {
  data: {
    id: string
    content: string | null
    streaming?: boolean
    status?: "pending" | "complete" | "failed"
    remembered?: { path: string; action: "created" | "updated" }[]
    merlinToolCalls?: ToolCall[]
    merlinReasoning?: string | null
    merlinReasoningSegments?: MerlinReasoningSegment[]
    mentions?: RealtimeMessageMention[]
    steeringBy?: string
    routedOutcome?: "steered" | "queued"
  }[]
}

type StreamPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  delta: string
  done: boolean
  status?: "complete" | "failed"
  replace?: boolean
  mentions?: RealtimeMessageMention[]
  runId?: string
  seq?: number
}

type ReasoningPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  delta: string
  at: number
  order: number
  runId?: string
  seq?: number
}

type MemoryPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  path: string
  action: "created" | "updated"
  nodeId?: string
  runId?: string
  seq?: number
}

type ToolPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  toolCall: ToolCall
  runId?: string
  seq?: number
}

type SteerPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  steeredMessageId: string
  authorName: string
  runId?: string
  seq?: number
}

type RoutedPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  outcome: "steered" | "queued"
  runId: string
  merlinMessageId: string
}

type QueueUpdatedPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  state: "consumed" | "rejected" | "cancelled"
}

type BufferedFrame =
  | { type: "stream"; payload: StreamPayload }
  | { type: "reasoning"; payload: ReasoningPayload }
  | { type: "memory"; payload: MemoryPayload }
  | { type: "tool"; payload: ToolPayload }
  | { type: "steer"; payload: SteerPayload }

// Late-join replay gate, keyed by placeholder message id. While the durable
// event log is being fetched, live frames buffer here; once replay is applied
// they drain in order, gated by seq so nothing is applied twice. Frames from
// legacy runs (no seq) always apply directly.
type ReplayGate =
  | { state: "buffering"; frames: BufferedFrame[] }
  | { state: "live"; maxSeq: number }

const replayGates = new Map<string, ReplayGate>()
// Message ids whose replay has been kicked off, so re-renders don't re-fetch.
const replayStarted = new Set<string>()

function clearReplayState(messageId: string) {
  replayGates.delete(messageId)
  replayStarted.delete(messageId)
}

// Returns true when the frame was consumed (buffered or already covered by
// replay) and must not be applied now.
function gateFrame(frame: BufferedFrame): boolean {
  const { payload } = frame
  const gate = replayGates.get(payload.messageId)
  if (!gate) return false
  if (gate.state === "buffering") {
    gate.frames.push(frame)
    return true
  }
  if (payload.seq === undefined) return false
  if (payload.seq <= gate.maxSeq) return true
  gate.maxSeq = payload.seq
  return false
}

export function messagesCacheKey(
  channelId: string,
  threadRootId: string | null
) {
  return threadRootId ? ["thread", threadRootId] : ["messages", channelId]
}

function patchMessage(
  queryClient: QueryClient,
  key: (string | null)[],
  messageId: string,
  patch: (m: MessagePage["data"][number]) => MessagePage["data"][number]
) {
  queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
    if (!old) return old
    return updateMessagesAcrossPages(old, (msgs) =>
      msgs.map((m) => (m.id === messageId ? patch(m) : m))
    )
  })
}

function applyStreamFrame(queryClient: QueryClient, payload: StreamPayload) {
  patchMessage(
    queryClient,
    messagesCacheKey(payload.channelId, payload.threadRootId),
    payload.messageId,
    (m) => ({
      ...m,
      content: payload.replace
        ? payload.delta
        : (m.content ?? "") + payload.delta,
      streaming: !payload.done,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.mentions ? { mentions: payload.mentions } : {}),
    })
  )
  if (payload.done) clearReplayState(payload.messageId)
}

function applyReasoningFrame(
  queryClient: QueryClient,
  payload: ReasoningPayload
) {
  patchMessage(
    queryClient,
    messagesCacheKey(payload.channelId, payload.threadRootId),
    payload.messageId,
    (m) => ({
      ...m,
      merlinReasoning: (m.merlinReasoning ?? "") + payload.delta,
      merlinReasoningSegments: appendReasoningSegment(
        m.merlinReasoningSegments,
        payload
      ),
      streaming: true,
    })
  )
}

function applyMemoryFrame(queryClient: QueryClient, payload: MemoryPayload) {
  patchMessage(
    queryClient,
    messagesCacheKey(payload.channelId, payload.threadRootId),
    payload.messageId,
    (m) => ({
      ...m,
      remembered: [
        ...(m.remembered ?? []).filter((r) => r.path !== payload.path),
        {
          path: payload.path,
          action: payload.action,
          ...(payload.nodeId ? { nodeId: payload.nodeId } : {}),
        },
      ],
    })
  )
}

function applyToolFrame(queryClient: QueryClient, payload: ToolPayload) {
  patchMessage(
    queryClient,
    messagesCacheKey(payload.channelId, payload.threadRootId),
    payload.messageId,
    (m) => ({
      ...m,
      // Upsert into the same trail the server persists, so live and
      // reloaded renders match (start adds the row, completion fills detail).
      merlinToolCalls: upsertToolCall(m.merlinToolCalls, payload.toolCall),
    })
  )
}

// A steered message was injected mid-run — surface who's steering on the
// placeholder ("applying new direction").
function applySteerFrame(queryClient: QueryClient, payload: SteerPayload) {
  patchMessage(
    queryClient,
    messagesCacheKey(payload.channelId, payload.threadRootId),
    payload.messageId,
    (m) => ({ ...m, steeringBy: payload.authorName, streaming: true })
  )
}

function applyBufferedFrame(queryClient: QueryClient, frame: BufferedFrame) {
  if (frame.type === "stream") applyStreamFrame(queryClient, frame.payload)
  else if (frame.type === "reasoning")
    applyReasoningFrame(queryClient, frame.payload)
  else if (frame.type === "memory") applyMemoryFrame(queryClient, frame.payload)
  else if (frame.type === "steer") applySteerFrame(queryClient, frame.payload)
  else applyToolFrame(queryClient, frame.payload)
}

type RunEvent = {
  seq: number
  payload:
    | { kind: "text"; delta: string; replace?: boolean }
    | { kind: "reasoning"; delta: string; at: number; order: number }
    | { kind: "tool"; toolCall: ToolCall }
    | {
        kind: "memory"
        path: string
        action: "created" | "updated"
        nodeId?: string
      }
    | { kind: "state"; state: string }
    | { kind: "steer"; messageId: string; authorName: string }
    | { kind: "queued"; messageId: string }
    | { kind: "truncate"; contentLength: number }
}

// Rebuild the streamed portion of a pending message from replayed events.
// Replay is authoritative up to its max seq, so streamed fields are replaced,
// not merged.
function applyReplayEvents(
  queryClient: QueryClient,
  key: (string | null)[],
  messageId: string,
  events: RunEvent[]
) {
  // undefined = the event type never appeared; presence (not truthiness)
  // decides application below, so a replay that nets out to "" still clears
  // stale cached text.
  let content: string | undefined
  let reasoning: string | undefined
  let segments: MerlinReasoningSegment[] | undefined
  let toolCalls: ToolCall[] | undefined
  let remembered: {
    path: string
    action: "created" | "updated"
    nodeId?: string
  }[] = []
  let steeringBy: string | undefined
  for (const e of events) {
    const p = e.payload
    if (p.kind === "text") {
      content = p.replace ? p.delta : (content ?? "") + p.delta
    } else if (p.kind === "reasoning") {
      reasoning = (reasoning ?? "") + p.delta
      segments = appendReasoningSegment(segments, p)
    } else if (p.kind === "tool") {
      toolCalls = upsertToolCall(toolCalls, p.toolCall)
    } else if (p.kind === "memory") {
      remembered = [
        ...remembered.filter((r) => r.path !== p.path),
        {
          path: p.path,
          action: p.action,
          ...(p.nodeId ? { nodeId: p.nodeId } : {}),
        },
      ]
    } else if (p.kind === "steer") {
      steeringBy = p.authorName
    }
  }
  patchMessage(queryClient, key, messageId, (m) => ({
    ...m,
    ...(content !== undefined ? { content } : {}),
    ...(reasoning !== undefined ? { merlinReasoning: reasoning } : {}),
    ...(segments ? { merlinReasoningSegments: segments } : {}),
    ...(toolCalls ? { merlinToolCalls: toolCalls } : {}),
    ...(remembered.length > 0 ? { remembered } : {}),
    ...(steeringBy ? { steeringBy } : {}),
    streaming: true,
  }))
}

async function replayRun(
  queryClient: QueryClient,
  args: { channelId: string; threadRootId: string | null; messageId: string }
) {
  const key = messagesCacheKey(args.channelId, args.threadRootId)
  const gate: ReplayGate = { state: "buffering", frames: [] }
  replayGates.set(args.messageId, gate)
  try {
    const res = await apiClient.v1.runs["by-message"][":messageId"].events.$get(
      { param: { messageId: args.messageId }, query: {} }
    )
    // 404 = legacy run with no durable log; anything else is best-effort too —
    // fall back to live-frames-only exactly as before replay existed. The
    // replayStarted marker stays so render churn doesn't re-fetch in a loop.
    if (!res.ok) {
      replayGates.delete(args.messageId)
      for (const frame of gate.frames) applyBufferedFrame(queryClient, frame)
      return
    }
    const { run, events } = await res.json()

    // Terminal run: the message row already holds the final content, trail,
    // and mentions — refetch it instead of rebuilding from events.
    if (
      run.state === "complete" ||
      run.state === "failed" ||
      run.state === "stopped"
    ) {
      replayGates.delete(args.messageId)
      void queryClient.invalidateQueries({ queryKey: key })
      return
    }

    applyReplayEvents(queryClient, key, args.messageId, events)
    const maxSeq = events.at(-1)?.seq ?? -1
    const buffered = gate.frames
    replayGates.set(args.messageId, { state: "live", maxSeq })
    for (const frame of buffered) {
      if (frame.payload.seq !== undefined && frame.payload.seq <= maxSeq) {
        continue
      }
      applyBufferedFrame(queryClient, frame)
      const live = replayGates.get(args.messageId)
      if (live?.state === "live" && frame.payload.seq !== undefined) {
        live.maxSeq = frame.payload.seq
      }
    }
  } catch {
    replayGates.delete(args.messageId)
    for (const frame of gate.frames) applyBufferedFrame(queryClient, frame)
  }
}

interface UseMerlinStreamOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
}

// Appends Merlin's streamed reply deltas into its placeholder message and
// toggles a transient `streaming` flag (for the thinking/typing indicator).
export function useMerlinStream({
  socket,
  queryClient,
  channelId,
}: UseMerlinStreamOptions) {
  useEffect(() => {
    if (!socket) return

    const handleStream = (payload: StreamPayload) => {
      if (payload.channelId !== channelId) return
      if (gateFrame({ type: "stream", payload })) return
      applyStreamFrame(queryClient, payload)
    }

    socket.on("message:stream", handleStream)
    return () => {
      socket.off("message:stream", handleStream)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleReasoning = (payload: ReasoningPayload) => {
      if (payload.channelId !== channelId) return
      if (gateFrame({ type: "reasoning", payload })) return
      applyReasoningFrame(queryClient, payload)
    }

    socket.on("merlin:reasoning", handleReasoning)
    return () => {
      socket.off("merlin:reasoning", handleReasoning)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleMemory = (payload: MemoryPayload) => {
      if (payload.channelId !== channelId) return
      if (gateFrame({ type: "memory", payload })) return
      applyMemoryFrame(queryClient, payload)
    }

    socket.on("merlin:memory", handleMemory)
    return () => {
      socket.off("merlin:memory", handleMemory)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleTool = (payload: ToolPayload) => {
      if (payload.channelId !== channelId) return
      if (gateFrame({ type: "tool", payload })) return
      applyToolFrame(queryClient, payload)
    }

    socket.on("merlin:tool", handleTool)
    return () => {
      socket.off("merlin:tool", handleTool)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleSteer = (payload: SteerPayload) => {
      if (payload.channelId !== channelId) return
      // The steer landed — the chip on the steered message has done its job.
      // Ungated: chips aren't replayed state, so clearing is always safe.
      patchMessage(
        queryClient,
        messagesCacheKey(payload.channelId, payload.threadRootId),
        payload.steeredMessageId,
        (m) => ({ ...m, routedOutcome: undefined })
      )
      if (gateFrame({ type: "steer", payload })) return
      applySteerFrame(queryClient, payload)
    }

    // The sender's mid-run message was absorbed by the active run — chip the
    // routed message so they see what happened (steered vs queued).
    const handleRouted = (payload: RoutedPayload) => {
      if (payload.channelId !== channelId) return
      patchMessage(
        queryClient,
        messagesCacheKey(payload.channelId, payload.threadRootId),
        payload.messageId,
        (m) => ({ ...m, routedOutcome: payload.outcome })
      )
    }

    // The queue row settled (drained, rejected, or withdrawn) — drop the chip.
    const handleQueueUpdated = (payload: QueueUpdatedPayload) => {
      if (payload.channelId !== channelId) return
      patchMessage(
        queryClient,
        messagesCacheKey(payload.channelId, payload.threadRootId),
        payload.messageId,
        (m) => ({ ...m, routedOutcome: undefined })
      )
    }

    socket.on("merlin:steer", handleSteer)
    socket.on("message:routed", handleRouted)
    socket.on("run:queue:updated", handleQueueUpdated)
    return () => {
      socket.off("merlin:steer", handleSteer)
      socket.off("message:routed", handleRouted)
      socket.off("run:queue:updated", handleQueueUpdated)
    }
  }, [socket, channelId, queryClient])
}

interface UseMerlinRunReplayOptions {
  queryClient: QueryClient
  channelId: string
  // The currently loaded messages of one cache (channel feed or open thread).
  messages: Array<{
    id: string
    status?: "pending" | "complete" | "failed"
    threadRootId?: string | null
  }>
}

// Late-join trace recovery: any pending Merlin placeholder in view gets its
// durable run event log replayed into the cache, so someone opening a thread
// mid-run sees the tools/reasoning/text streamed so far, not just a spinner.
// Safe for runs this client watched from the start — replay returns what's
// already rendered and live frames buffer/drain by seq in the meantime.
export function useMerlinRunReplay({
  queryClient,
  channelId,
  messages,
}: UseMerlinRunReplayOptions) {
  const pendingIds = messages
    .filter((m) => m.status === "pending" && !replayStarted.has(m.id))
    .map((m) => `${m.id}:${m.threadRootId ?? ""}`)
    .join(",")

  useEffect(() => {
    if (!pendingIds) return
    for (const entry of pendingIds.split(",")) {
      const [messageId, threadRootId] = entry.split(":")
      if (!messageId || replayStarted.has(messageId)) continue
      replayStarted.add(messageId)
      void replayRun(queryClient, {
        channelId,
        threadRootId: threadRootId || null,
        messageId,
      })
    }
  }, [pendingIds, queryClient, channelId])
}
