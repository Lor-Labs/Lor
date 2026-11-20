import { and, asc, count, db, eq, inArray, lte, schema } from "@repo/db"
import {
  type AgentWakeUps,
  addInboxNote,
  wakeUpInboxNote,
} from "@repo/lor/channel-agent"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"

// The channel agent's wake-ups (reference/always-on-agents.md, decision 10):
// `wake_up` stores one, and the minute sweep puts each due one in the
// channel's inbox in the wake lane.

const MAX_MINUTES = 30 * 24 * 60
const PENDING_MAX = 20
const SWEEP_BATCH = 100
// Compaction waits for a wake-up this close: that turn will run anyway.
const COMPACT_WAKE_UP_MARGIN_MS = 15 * 60_000

type Deps = { emitter: Emitter<ServerToClientEvents> }

function emitUpdated(deps: Deps, channelId: string) {
  deps.emitter
    .to(channelRoom(channelId))
    .emit("agent:wake-ups:updated", { channelId })
}

// When `at` or `inMinutes` asks for, within a minute and 30 days. A string
// is an error for the model.
function dueTime(input: { inMinutes?: number; at?: string }): Date | string {
  if (input.inMinutes !== undefined && input.at !== undefined) {
    return "Give inMinutes or at, not both."
  }
  if (input.inMinutes !== undefined) {
    const minutes = Math.round(input.inMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      return "inMinutes must be from 1 to 43200."
    }
    return new Date(Date.now() + minutes * 60_000)
  }
  if (input.at !== undefined) {
    // An offset is required: a bare time would be read in the server's zone.
    if (!/(Z|[+-]\d\d:?\d\d)$/i.test(input.at.trim())) {
      return "at needs an offset, like 2026-11-21T15:00:00-05:00."
    }
    const at = new Date(input.at)
    const ahead = at.getTime() - Date.now()
    if (Number.isNaN(at.getTime())) return "at is not an ISO 8601 time."
    if (ahead < 60_000 || ahead > MAX_MINUTES * 60_000) {
      return "at must be between a minute and 30 days from now."
    }
    return at
  }
  return "Give inMinutes or at."
}

export function agentWakeUpExecutors(
  deps: Deps,
  input: {
    workspaceId: string
    channelId: string
    runId: string
    askedById: string | null
  }
): AgentWakeUps {
  return {
    schedule: async ({ note, inMinutes, at }) => {
      const dueAt = dueTime({
        ...(inMinutes !== undefined ? { inMinutes } : {}),
        ...(at !== undefined ? { at } : {}),
      })
      if (typeof dueAt === "string") return { ok: false, error: dueAt }
      const [pending] = await db
        .select({ value: count() })
        .from(schema.agentWakeUp)
        .where(
          and(
            eq(schema.agentWakeUp.channelId, input.channelId),
            eq(schema.agentWakeUp.status, "pending")
          )
        )
      if ((pending?.value ?? 0) >= PENDING_MAX) {
        return {
          ok: false,
          error: `You have ${PENDING_MAX} wake-ups pending here. Cancel one you no longer need first.`,
        }
      }
      const [row] = await db
        .insert(schema.agentWakeUp)
        .values({
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          dueAt,
          note: note.trim(),
          runId: input.runId,
          askedById: input.askedById,
        })
        .returning({
          id: schema.agentWakeUp.id,
          dueAt: schema.agentWakeUp.dueAt,
        })
      if (!row) throw new Error("Wake-up insert returned no row")
      emitUpdated(deps, input.channelId)
      return { ok: true, wakeUpId: row.id, dueAt: row.dueAt.toISOString() }
    },
    cancel: async ({ wakeUpId }) => {
      const cancelled = await db
        .update(schema.agentWakeUp)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(
          and(
            eq(schema.agentWakeUp.id, wakeUpId),
            eq(schema.agentWakeUp.channelId, input.channelId),
            eq(schema.agentWakeUp.status, "pending")
          )
        )
        .returning({ id: schema.agentWakeUp.id })
      if (!cancelled[0]) {
        return { ok: false, error: "No pending wake-up with that id here." }
      }
      emitUpdated(deps, input.channelId)
      return { ok: true }
    },
  }
}

// The minute sweep: each due wake-up becomes an inbox item (duplicates are
// dropped on its id, so a crash between the two writes repeats safely), then
// is marked fired, and the channel's inbox is read.
export async function sweepDueWakeUps(
  deps: Deps & { agentInboxQueue: Queue<AgentInboxFlushJobData> }
): Promise<void> {
  const due = await db
    .select({
      id: schema.agentWakeUp.id,
      workspaceId: schema.agentWakeUp.workspaceId,
      channelId: schema.agentWakeUp.channelId,
      note: schema.agentWakeUp.note,
      createdAt: schema.agentWakeUp.createdAt,
    })
    .from(schema.agentWakeUp)
    .where(
      and(
        eq(schema.agentWakeUp.status, "pending"),
        lte(schema.agentWakeUp.dueAt, new Date())
      )
    )
    .orderBy(asc(schema.agentWakeUp.dueAt))
    .limit(SWEEP_BATCH)
  if (due.length === 0) return

  const channels = new Set<string>()
  const delivered: string[] = []
  for (const wakeUp of due) {
    try {
      await addInboxNote({
        workspaceId: wakeUp.workspaceId,
        channelId: wakeUp.channelId,
        source: "wake_up",
        sourceId: wakeUp.id,
        note: wakeUpInboxNote({ setAt: wakeUp.createdAt, note: wakeUp.note }),
        lane: "wake",
      })
      channels.add(wakeUp.channelId)
      delivered.push(wakeUp.id)
    } catch (err) {
      logger.error({ err, wakeUpId: wakeUp.id }, "Wake-up delivery failed")
    }
  }
  if (delivered.length > 0) {
    await db
      .update(schema.agentWakeUp)
      .set({ status: "fired", firedAt: new Date() })
      .where(
        and(
          inArray(schema.agentWakeUp.id, delivered),
          eq(schema.agentWakeUp.status, "pending")
        )
      )
  }
  for (const channelId of channels) {
    emitUpdated(deps, channelId)
    await deps.agentInboxQueue
      .add(AGENT_INBOX_FLUSH_JOB, { channelId })
      .catch((err) =>
        logger.error({ err, channelId }, "Wake-up inbox flush failed")
      )
  }
  logger.info({ fired: delivered.length }, "Wake-ups fired")
}

export async function wakeUpDueSoon(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentWakeUp.id })
    .from(schema.agentWakeUp)
    .where(
      and(
        eq(schema.agentWakeUp.channelId, channelId),
        eq(schema.agentWakeUp.status, "pending"),
        lte(
          schema.agentWakeUp.dueAt,
          new Date(Date.now() + COMPACT_WAKE_UP_MARGIN_MS)
        )
      )
    )
    .limit(1)
  return Boolean(row)
}
