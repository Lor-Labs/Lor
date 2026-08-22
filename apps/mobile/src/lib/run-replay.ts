import type { ServerToClientEvents } from "@repo/realtime-types"
import { appendReasoningSegment, upsertToolCall } from "@repo/utils/merlin"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import { appendMerlinReasoning, upsertMerlinToolCall } from "@/lib/merlin"

type FramePayload<E extends keyof ServerToClientEvents> = Parameters<
  ServerToClientEvents[E]
>[0]

export type MerlinFrame =
  | { type: "stream"; payload: FramePayload<"message:stream"> }
  | { type: "reasoning"; payload: FramePayload<"merlin:reasoning"> }
  | { type: "memory"; payload: FramePayload<"merlin:memory"> }
  | { type: "tool"; payload: FramePayload<"merlin:tool"> }
  | { type: "steer"; payload: FramePayload<"merlin:steer"> }

// Late-join replay gate, keyed by placeholder message id (mirror of web's
// use-merlin-stream.ts). While the durable event log is being fetched, live
// frames buffer here; once replay is applied they drain in order, gated by
// seq so nothing is applied twice. Frames without a seq always apply directly.
type ReplayGate =
  | { state: "buffering"; frames: MerlinFrame[] }
  | { state: "live"; maxSeq: number }

const replayGates = new Map<string, ReplayGate>()
const replayStarted = new Set<string>()

function clearRunReplay(messageId: string) {
  replayGates.delete(messageId)
  replayStarted.delete(messageId)
}

// Consumer refcounts: a channel screen and a thread rooted at the same
// placeholder can watch one message at once, so replay state is only cleared
// when the LAST consumer detaches — a remount can then replay an active run
// instead of being deduped forever.
const replayHolds = new Map<string, number>()

export function retainRunReplay(messageId: string) {
  replayHolds.set(messageId, (replayHolds.get(messageId) ?? 0) + 1)
}

export function releaseRunReplay(messageId: string) {
  const next = (replayHolds.get(messageId) ?? 0) - 1
  if (next > 0) {
    replayHolds.set(messageId, next)
    return
  }
  replayHolds.delete(messageId)
  clearRunReplay(messageId)
}

// Returns true when the frame was consumed (buffered or already covered by
// replay) and must not be applied now.
export function gateRunFrame(frame: MerlinFrame): boolean {
  const gate = replayGates.get(frame.payload.messageId)
  if (!gate) return false
  if (gate.state === "buffering") {
    gate.frames.push(frame)
    return true
  }
  if (frame.payload.seq === undefined) return false
  if (frame.payload.seq <= gate.maxSeq) return true
  gate.maxSeq = frame.payload.seq
  return false
}

export function applyMerlinFrame(
  message: Message,
  frame: MerlinFrame
): Message {
  if (frame.type === "stream") {
    const { payload } = frame
    // The run is over — the next pending placeholder on this id (if any)
    // belongs to a fresh run and gets its own replay.
    if (payload.done) clearRunReplay(payload.messageId)
    return {
      ...message,
      content: payload.replace
        ? payload.delta
        : `${message.content ?? ""}${payload.delta}`,
      mentions: payload.mentions ?? message.mentions,
      status: payload.done ? (payload.status ?? "complete") : "pending",
    }
  }
  if (frame.type === "reasoning") {
    return appendMerlinReasoning(message, frame.payload)
  }
  if (frame.type === "tool") {
    return upsertMerlinToolCall(message, frame.payload.toolCall)
  }
  if (frame.type === "memory") {
    return {
      ...message,
      remembered: [
        ...(message.remembered ?? []).filter(
          (memory) => memory.path !== frame.payload.path
        ),
        {
          path: frame.payload.path,
          action: frame.payload.action,
          ...(frame.payload.nodeId ? { nodeId: frame.payload.nodeId } : {}),
        },
      ],
    }
  }
  return { ...message, steeringBy: frame.payload.authorName }
}

type RunEventsClient =
  (typeof api)["v1"]["runs"]["by-message"][":messageId"]["events"]["$get"]
type RunEventsResponse = Awaited<
  ReturnType<Awaited<ReturnType<RunEventsClient>>["json"]>
>
type RunEvents = Extract<RunEventsResponse, { events: unknown }>["events"]

// Rebuild the streamed portion of a pending message from replayed events.
// Replay is authoritative up to its max seq, so streamed fields are replaced,
// not merged.
function foldRunEvents(events: RunEvents): Partial<Message> {
  let content = ""
  let reasoning = ""
  let segments: Message["merlinReasoningSegments"]
  let toolCalls: Message["merlinToolCalls"]
  let remembered: NonNullable<Message["remembered"]> = []
  let steeringBy: string | undefined
  for (const event of events) {
    const p = event.payload
    if (p.kind === "text") {
      content = p.replace ? p.delta : content + p.delta
    } else if (p.kind === "reasoning") {
      reasoning += p.delta
      segments = appendReasoningSegment(segments, p)
    } else if (p.kind === "tool") {
      toolCalls = upsertToolCall(toolCalls, p.toolCall)
    } else if (p.kind === "memory") {
      remembered = [
        ...remembered.filter((memory) => memory.path !== p.path),
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
  return {
    ...(content ? { content } : {}),
    ...(reasoning ? { merlinReasoning: reasoning } : {}),
    ...(segments ? { merlinReasoningSegments: segments } : {}),
    ...(toolCalls ? { merlinToolCalls: toolCalls } : {}),
    ...(remembered.length > 0 ? { remembered } : {}),
    ...(steeringBy ? { steeringBy } : {}),
    status: "pending",
  }
}

type ReplayOptions = {
  messageId: string
  applyPatch: (messageId: string, patch: Partial<Message>) => void
  applyFrame: (frame: MerlinFrame) => void
  onTerminal: () => void
}

// Late-join trace recovery: replay a pending Merlin placeholder's durable run
// event log into the hook's message state, so opening a channel/thread mid-run
// shows the tools/reasoning/text streamed so far, not just a spinner. Safe for
// runs this client watched from the start — replay returns what's already
// rendered and live frames buffer/drain by seq in the meantime.
export function startRunReplay(options: ReplayOptions) {
  if (replayStarted.has(options.messageId)) return
  replayStarted.add(options.messageId)
  void replayRun(options)
}

async function replayRun({
  messageId,
  applyPatch,
  applyFrame,
  onTerminal,
}: ReplayOptions) {
  const gate: ReplayGate = { state: "buffering", frames: [] }
  replayGates.set(messageId, gate)
  // Released (consumer unmounted) or superseded by a remount's replay while
  // the fetch was in flight — this pass must not touch the fresh gate.
  const isCurrent = () => replayGates.get(messageId) === gate
  try {
    const res = await api.v1.runs["by-message"][":messageId"].events.$get({
      param: { messageId },
      query: {},
    })
    if (!isCurrent()) return
    // 404 = legacy run with no durable log; anything else is best-effort too —
    // fall back to live-frames-only. The replayStarted marker stays so render
    // churn doesn't re-fetch in a loop.
    if (!res.ok) {
      replayGates.delete(messageId)
      for (const frame of gate.frames) applyFrame(frame)
      return
    }
    const { run, events } = await res.json()
    if (!isCurrent()) return

    // Terminal run: the message row already holds the final content, trail,
    // and mentions — refetch it instead of rebuilding from events.
    if (
      run.state === "complete" ||
      run.state === "failed" ||
      run.state === "stopped"
    ) {
      replayGates.delete(messageId)
      onTerminal()
      return
    }

    applyPatch(messageId, foldRunEvents(events))
    const maxSeq = events.at(-1)?.seq ?? -1
    const buffered = gate.frames
    replayGates.set(messageId, { state: "live", maxSeq })
    for (const frame of buffered) {
      if (frame.payload.seq !== undefined && frame.payload.seq <= maxSeq) {
        continue
      }
      applyFrame(frame)
      const live = replayGates.get(messageId)
      if (live?.state === "live" && frame.payload.seq !== undefined) {
        live.maxSeq = frame.payload.seq
      }
    }
  } catch {
    if (!isCurrent()) return
    replayGates.delete(messageId)
    for (const frame of gate.frames) applyFrame(frame)
  }
}
