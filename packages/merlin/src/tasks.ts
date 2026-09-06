import { and, db, eq, isNull, or, schema } from "@repo/db"
import type { AgentRunContextTask, Task, TaskPlanItem } from "@repo/db/schema"
import type { RealtimeTask } from "@repo/realtime-types/events"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"
import type { Exact, SerializedDates } from "./wire-guard"

// The single task-row → wire-type mapping (used by every task:updated emit
// across api/worker/realtime — previously three drifting copies).
// Drift guard (see wire-guard.ts): RealtimeTask must stay the exact
// date-serialized mirror of the task row, minus deliberate omissions.
type OffWireTaskColumns =
  // Spawn provenance (Act/loop runs) — server-side lineage, no card renders
  // it; the loop run UI queries it, never receives it over the socket.
  "originRunId"
const _realtimeTaskMirrorsDbRow: Exact<
  Omit<SerializedDates<Task>, OffWireTaskColumns>,
  RealtimeTask
> = true
void _realtimeTaskMirrorsDbRow

export function toRealtimeTask(row: Task): RealtimeTask {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    cardMessageId: row.cardMessageId,
    creatorId: row.creatorId,
    title: row.title,
    goal: row.goal,
    status: row.status,
    plan: row.plan,
    summary: row.summary,
    activeRunId: row.activeRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const MAX_PLAN_ITEMS = 30
const MAX_ITEM_CHARS = 200
// Deliberately tight: the card renders this as a single muted line under the
// step, so it has to stay one clause rather than a paragraph.
const MAX_DESCRIPTION_CHARS = 120
// The card clamps the summary to three lines (~270 chars at its max width), so
// anything longer is written to be truncated. Detail belongs in Merlin's final
// message, where the team can actually read it.
const MAX_SUMMARY_CHARS = 300

export type OnTaskUpdated = (task: Task) => void

const taskContext = z.object({
  taskId: z.string(),
  workspaceId: z.string(),
  runId: z.string().nullable(),
  onTaskUpdated: z.custom<OnTaskUpdated>().optional(),
  // Lets respond() force a final text step once an approval is pending.
  onApprovalRequested: z.custom<() => void>().optional(),
})

// Settle the task a run leaves behind when it dies outside its processor
// (crash swept by sweepDeadRuns, stopped while still queued, or a first run
// that never got enqueued). Keys on the claimed run id, or — for a run that
// never claimed — the task card that is the run's thread root, guarded on
// activeRunId being unset so a newer continuation's task is never clobbered.
// Active plan steps demote to pending so the card stops showing a spinning
// step (complete_task normalizes the plan on success; abnormal ends must too).
export async function settleAbandonedRunTask(
  run: { id?: string; threadRootId: string | null },
  status: "failed" | "stopped",
  onTaskUpdated?: OnTaskUpdated
): Promise<void> {
  const linkage = or(
    run.id ? eq(schema.task.activeRunId, run.id) : undefined,
    run.threadRootId
      ? and(
          eq(schema.task.cardMessageId, run.threadRootId),
          isNull(schema.task.activeRunId)
        )
      : undefined
  )
  if (!linkage) return
  const target = await db
    .select({ id: schema.task.id, plan: schema.task.plan })
    .from(schema.task)
    .where(and(eq(schema.task.status, "running"), linkage))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!target) return
  const plan = target.plan.map((item) =>
    item.status === "active" ? { ...item, status: "pending" as const } : item
  )
  const row = await db
    .update(schema.task)
    .set({ status, activeRunId: null, plan })
    .where(
      and(
        eq(schema.task.id, target.id),
        eq(schema.task.status, "running"),
        linkage
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (row && onTaskUpdated) {
    try {
      onTaskUpdated(row)
    } catch (err) {
      logger.error({ err }, "onTaskUpdated listener failed")
    }
  }
}

export async function updateTask(
  taskId: string,
  values: Partial<typeof schema.task.$inferInsert>,
  onTaskUpdated?: OnTaskUpdated
): Promise<Task | null> {
  const row = await db
    .update(schema.task)
    .set(values)
    .where(eq(schema.task.id, taskId))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (row && onTaskUpdated) {
    try {
      onTaskUpdated(row)
    } catch (err) {
      logger.error({ err }, "onTaskUpdated listener failed")
    }
  }
  return row
}

const planItemSchema = z.object({
  text: z.string().min(1).max(MAX_ITEM_CHARS),
  status: z.enum(["pending", "active", "done"]),
  // Nullable rather than optional to stay valid under `strict: true`, which
  // requires every property to be present. Nulls are dropped on the way in.
  description: z.string().max(MAX_DESCRIPTION_CHARS).nullable(),
})

export const taskTools = {
  set_plan: tool({
    description:
      "Replace the task's plan checklist — the team sees it live on the task card. Call it when you first break the work down, and again whenever an item's status changes (mark items done as you finish them, active while you work on them). Pass the FULL plan every time; it replaces the previous one. An item may carry a `description`: ONE short clause (under 120 chars) adding context the label itself doesn't convey — pass null for every other item, which is most of them. Preserve the descriptions already on the plan when you resend it.",
    inputSchema: z.object({
      items: z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS),
    }),
    contextSchema: taskContext,
    execute: async ({ items }, { context }) => {
      const plan: TaskPlanItem[] = items.map(
        ({ text, status, description }) => {
          const detail = description?.trim()
          return detail
            ? { text, status, description: detail }
            : { text, status }
        }
      )
      const row = await updateTask(
        context.taskId,
        { plan },
        context.onTaskUpdated
      )
      if (!row) return { error: "task not found" }
      return { ok: true }
    },
    strict: true,
  }),

  complete_task: tool({
    description:
      "Mark the task completed, with a one-line summary of what was delivered. Call this ONLY when the work is genuinely done and the deliverables exist — never to give up (just explain instead; the task stays open for the team). The summary is a headline on the task card, not a report: ONE sentence (two at most, 300 chars hard limit) naming what the team now has and anything they must know. No methodology, no per-file walkthrough, no restating counts or filenames — delivered files are already linked on the card. Put the detail in the final message you write straight after this call.",
    inputSchema: z.object({
      summary: z
        .string()
        .min(1)
        .max(MAX_SUMMARY_CHARS)
        .describe(
          "one sentence, headline style — what was delivered and any caveat"
        ),
    }),
    contextSchema: taskContext,
    execute: async ({ summary }, { context }) => {
      // Completing the task settles the checklist: the model routinely forgets
      // a final set_plan, which left cards showing a spinning step forever.
      const current = await db
        .select({ plan: schema.task.plan })
        .from(schema.task)
        .where(eq(schema.task.id, context.taskId))
        .limit(1)
        .then((rows) => rows[0])
      if (!current) return { error: "task not found" }
      const plan = current.plan.map((item) =>
        item.status === "done" ? item : { ...item, status: "done" as const }
      )
      const row = await updateTask(
        context.taskId,
        { status: "completed", summary, plan },
        context.onTaskUpdated
      )
      if (!row) return { error: "task not found" }
      return { ok: true }
    },
    strict: true,
  }),

  request_approval: tool({
    description:
      "Ask the team to approve a consequential action before you take it (external writes: filing issues, posting to third-party tools, anything hard to undo). Describe exactly what will happen in plain language. After calling this, wrap up your current message — you'll be re-invoked when someone approves or rejects, and only then may you act.",
    inputSchema: z.object({
      action: z
        .string()
        .min(1)
        .max(100)
        .describe("short machine slug for the action, e.g. linear_write"),
      description: z
        .string()
        .min(1)
        .max(2000)
        .describe("plain-language consequences, shown on the approval card"),
    }),
    contextSchema: taskContext,
    execute: async ({ action, description }, { context }) => {
      try {
        const inserted = await db
          .insert(schema.approval)
          .values({
            workspaceId: context.workspaceId,
            taskId: context.taskId,
            runId: context.runId,
            action,
            description,
          })
          .onConflictDoNothing()
          .returning({ id: schema.approval.id })
          .then((rows) => rows[0] ?? null)
        if (!inserted) {
          return {
            error:
              "an approval is already pending on this task; wait for it to be resolved",
          }
        }
        await updateTask(
          context.taskId,
          { status: "waiting_for_approval" },
          context.onTaskUpdated
        )
        try {
          context.onApprovalRequested?.()
        } catch (err) {
          logger.error({ err }, "onApprovalRequested listener failed")
        }
        return {
          ok: true,
          approvalId: inserted.id,
          note: "approval requested — finish your message now; you'll be re-invoked on resolution",
        }
      } catch (err) {
        logger.error({ err }, "request_approval failed")
        return { error: "couldn't file the approval request" }
      }
    },
    strict: true,
  }),
}

// The context of the task a run belongs to, threaded from the worker.
export type RunTaskContext = {
  id: string
  title: string
  goal: string
  status: Task["status"]
  plan: TaskPlanItem[]
  summary: string | null
}

// Static half of the task prompt: identical for every task run, so it lives in
// the instructions and stays inside the cached prompt prefix. The task's own
// title/goal/status/plan are volatile and ride the conversation snapshot
// instead — see taskStateSection.
export function taskRulesSection(artifactsEnabled: boolean): string {
  return [
    "## Active task",
    "You are working a delegated task for the team — not answering a one-off question. The task's title, goal, and current plan appear at the end of the conversation below.",
    "",
    "Task rules:",
    "- Keep the plan current with set_plan: set it when you start, mark items done as you finish them. The team watches it live.",
    ...(artifactsEnabled
      ? [
          "- Produce real deliverables with create_artifacts; share their links.",
        ]
      : []),
    "- Before consequential external actions (writes to third-party tools), call request_approval and stop; act only after a human approves.",
    "- When the work is fully done, call complete_task with a summary. If you need input from the team, ask and end your message — the task waits for their reply.",
    "- complete_task's summary is a one-sentence headline for the card — keep the detail for the message you write after it.",
    "- Anyone on the team may reply with new instructions mid-task; treat the newest instruction as authoritative.",
  ].join("\n")
}

// Volatile half: rendered at the tail of the initial user message, where a
// change costs only the tail of the prompt rather than invalidating all of it.
export function taskStateSection(task: AgentRunContextTask): string {
  const plan = task.plan.length
    ? task.plan
        .map(
          (i) =>
            `- [${i.status}] ${i.text}${i.description ? ` — ${i.description}` : ""}`
        )
        .join("\n")
    : "(no plan yet)"
  return [
    "\n\n## Your active task",
    `Task: "${task.title}" (status: ${task.status}).`,
    `Goal: ${task.goal}`,
    ...(task.summary ? [`Summary so far: ${task.summary}`] : []),
    `Current plan:\n${plan}`,
  ].join("\n")
}

export function taskContextSnapshot(task: RunTaskContext): AgentRunContextTask {
  return {
    title: task.title,
    goal: task.goal,
    status: task.status,
    plan: task.plan,
    summary: task.summary,
  }
}
