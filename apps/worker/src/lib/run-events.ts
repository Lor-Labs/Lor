import { and, db, eq, inArray, schema } from "@repo/db"
import type {
  AgentRunEventPayload,
  AgentRunState,
  AgentRunStopReason,
} from "@repo/db/schema"
import { logger } from "@/lib/logger"

const FLUSH_MS = 1000
const FLUSH_MAX_BUFFERED = 50

// Buffered writer for a run's ordered event log. The lease-holding worker is
// the sole writer, so sequence numbers are allocated in memory and the
// high-water mark is persisted with each flush. Socket frames carry the same
// seq, letting clients replay persisted events and then drain buffered live
// frames without gaps. A crash loses at most the un-flushed tail —
// pre-checkpoint output that recovery discards anyway (the claim also jumps
// the sequence past any such tail, so a zombie's frames can never collide).
export type RunEventWriter = {
  runId: string | null
  // Buffer an event and return its seq (undefined on legacy runs without a row).
  append: (payload: AgentRunEventPayload) => number | undefined
  // Move the run's state; writes a state event and flushes immediately.
  transition: (
    state: AgentRunState,
    opts?: { stopReason?: AgentRunStopReason }
  ) => Promise<void>
  // Final flush; call once the job is done with the writer.
  close: () => Promise<void>
}

export const noopRunEventWriter: RunEventWriter = {
  runId: null,
  append: () => undefined,
  transition: async () => {},
  close: async () => {},
}

type BufferedEvent = { seq: number; payload: AgentRunEventPayload }

// Merge contiguous streaming deltas so a long answer persists as a few rows
// per second instead of one per frame. A merged row keeps the LAST seq of its
// range: replay hands the client that seq as its high-water mark, so buffered
// live frames from inside the range are correctly dropped as already-covered.
function coalesce(events: BufferedEvent[]): BufferedEvent[] {
  const out: BufferedEvent[] = []
  for (const e of events) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.payload.kind === "text" &&
      e.payload.kind === "text" &&
      !prev.payload.replace &&
      !e.payload.replace
    ) {
      prev.payload = {
        kind: "text",
        delta: prev.payload.delta + e.payload.delta,
      }
      prev.seq = e.seq
    } else if (
      prev &&
      prev.payload.kind === "reasoning" &&
      e.payload.kind === "reasoning" &&
      prev.payload.at === e.payload.at &&
      prev.payload.order === e.payload.order
    ) {
      prev.payload = {
        ...prev.payload,
        delta: prev.payload.delta + e.payload.delta,
      }
      prev.seq = e.seq
    } else if (
      prev &&
      prev.payload.kind === "tool" &&
      e.payload.kind === "tool" &&
      prev.payload.toolCall.toolCallId === e.payload.toolCall.toolCallId
    ) {
      // Tool frames are whole-row snapshots (streamed sandbox summaries
      // arrive many times per call) — the latest supersedes.
      prev.payload = e.payload
      prev.seq = e.seq
    } else {
      out.push({ seq: e.seq, payload: e.payload })
    }
  }
  return out
}

// Writer for a run this worker has already claimed (see claimAgentRun). All
// persistence is guarded on the lease owner, so a zombie attempt that lost
// its lease writes nothing.
export function createRunEventWriter(args: {
  runId: string
  workerId: string
  initialSeq: number
}): RunEventWriter {
  const { runId, workerId } = args
  let nextSeq = args.initialSeq
  let buffer: BufferedEvent[] = []
  let timer: NodeJS.Timeout | null = null
  // Serializes flushes so batches land in seq order even if one stalls.
  let flushing: Promise<void> = Promise.resolve()

  const flushNow = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (buffer.length === 0) return
    const batch = coalesce(buffer)
    buffer = []
    const highWater = nextSeq
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.agentRunEvent)
          .values(
            batch.map((e) => ({
              runId,
              seq: e.seq,
              kind: e.payload.kind,
              payload: e.payload,
            }))
          )
          .onConflictDoNothing()
        await tx
          .update(schema.agentRun)
          .set({ nextSeq: highWater })
          .where(
            and(
              eq(schema.agentRun.id, runId),
              eq(schema.agentRun.leaseOwner, workerId)
            )
          )
      })
    } catch (err) {
      // Dropped batch: replay loses these events but live frames already went
      // out and the final message row still persists the durable trail.
      logger.warn({ err, runId, count: batch.length }, "Run event flush failed")
    }
  }

  const enqueueFlush = () => {
    flushing = flushing.then(flushNow)
    return flushing
  }

  const append = (payload: AgentRunEventPayload) => {
    const seq = nextSeq++
    buffer.push({ seq, payload })
    if (buffer.length >= FLUSH_MAX_BUFFERED) {
      void enqueueFlush()
    } else if (!timer) {
      timer = setTimeout(() => void enqueueFlush(), FLUSH_MS)
    }
    return seq
  }

  const transition = async (
    state: AgentRunState,
    opts?: { stopReason?: AgentRunStopReason }
  ) => {
    append({ kind: "state", state, stopReason: opts?.stopReason })
    await enqueueFlush()
    const terminal =
      state === "complete" || state === "failed" || state === "stopped"
    await db
      .update(schema.agentRun)
      .set({
        state,
        ...(opts?.stopReason ? { stopReason: opts.stopReason } : {}),
        ...(terminal ? { finishedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(schema.agentRun.id, runId),
          eq(schema.agentRun.leaseOwner, workerId),
          // Never resurrect a terminal run (e.g. a failed transition racing a
          // takeover that already finished).
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      )
      .catch((err) =>
        logger.warn({ err, runId, state }, "Agent run transition failed")
      )
  }

  return {
    runId,
    append,
    transition,
    close: () => enqueueFlush(),
  }
}
