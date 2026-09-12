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
    threadRootId: row.threadRootId,
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

// start_task creation is delegated to the host (the worker posts the card
// message and inserts the row — message fanout machinery lives there).
export type StartTaskInput = {
  title: string
  goal: string
  plan: TaskPlanItem[]
}
export type CreateTaskForThread = (
  input: StartTaskInput
) => Promise<Task | null>

// Task id resolves through a getter, not a static value: a task created by
// start_task mid-run must be visible to set_plan/complete_task/request_approval
// bound in the same respond() call (tool contexts are resolved eagerly).
const taskContext = z.object({
  getTaskId: z.custom<() => string | null>(),
  workspaceId: z.string(),
  runId: z.string().nullable(),
  onTaskUpdated: z.custom<OnTaskUpdated>().optional(),
  // Lets respond() force a final text step once an approval is pending.
  onApprovalRequested: z.custom<() => void>().optional(),
})

const NO_TASK_ERROR =
  "no task exists for this thread yet — call start_task first"

// Settle the task a run leaves behind when it dies outside its processor
// (crash swept by sweepDeadRuns, stopped while still queued, or a first run
// that never got enqueued). Keys on the claimed run id, or — for a run that
// never claimed — the task anchored to the run's thread root, guarded on
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
          eq(schema.task.threadRootId, run.threadRootId),
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

function normalizePlanItems(
  items: z.infer<typeof planItemSchema>[]
): TaskPlanItem[] {
  return items.map(({ text, status, description }) => {
    const detail = description?.trim()
    return detail ? { text, status, description: detail } : { text, status }
  })
}

const startTaskContext = z.object({
  getTaskId: z.custom<() => string | null>(),
  createTask: z.custom<CreateTaskForThread>().optional(),
})

export const taskTools = {
  start_task: tool({
    description:
      "Turn this thread's request into a tracked task: a live card the team watches while you work. Call it BEFORE starting substantial delegated work with a deliverable outcome — produce or transform files, analyze data and deliver results, write a document or report, complete multi-step work. Never for questions (even hard ones), quick answers, code changes (propose_code_change handles those), or recurring/scheduled work (loop tools handle those). Pass a short imperative title like an issue title, the goal in one or two sentences, and your initial plan.",
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(80)
        .describe("short imperative title, 3-8 words, like an issue title"),
      goal: z
        .string()
        .min(1)
        .max(2000)
        .describe("the outcome being delivered, one or two sentences"),
      plan: z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS),
    }),
    contextSchema: startTaskContext,
    execute: async ({ title, goal, plan }, { context }) => {
      if (context.getTaskId()) {
        return { error: "a task already exists for this thread" }
      }
      if (!context.createTask) {
        return { error: "tasks can't be started from this context" }
      }
      const row = await context.createTask({
        title: title.trim(),
        goal: goal.trim(),
        plan: normalizePlanItems(plan),
      })
      if (!row) return { error: "couldn't start the task" }
      return {
        ok: true,
        taskId: row.id,
        note: "task started — the team sees the card and plan live; keep it current with set_plan and finish with complete_task",
      }
    },
    strict: true,
  }),

  set_plan: tool({
    description:
      "Replace the task's plan checklist — the team sees it live on the task card. Call it when you first break the work down, and again whenever an item's status changes (mark items done as you finish them, active while you work on them). Pass the FULL plan every time; it replaces the previous one. An item may carry a `description`: ONE short clause (under 120 chars) adding context the label itself doesn't convey — pass null for every other item, which is most of them. Preserve the descriptions already on the plan when you resend it.",
    inputSchema: z.object({
      items: z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS),
    }),
    contextSchema: taskContext,
    execute: async ({ items }, { context }) => {
      const taskId = context.getTaskId()
      if (!taskId) return { error: NO_TASK_ERROR }
      const row = await updateTask(
        taskId,
        { plan: normalizePlanItems(items) },
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
      const taskId = context.getTaskId()
      if (!taskId) return { error: NO_TASK_ERROR }
      // Completing the task settles the checklist: the model routinely forgets
      // a final set_plan, which left cards showing a spinning step forever.
      const current = await db
        .select({ plan: schema.task.plan })
        .from(schema.task)
        .where(eq(schema.task.id, taskId))
        .limit(1)
        .then((rows) => rows[0])
      if (!current) return { error: "task not found" }
      const plan = current.plan.map((item) =>
        item.status === "done" ? item : { ...item, status: "done" as const }
      )
      const row = await updateTask(
        taskId,
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
      const taskId = context.getTaskId()
      if (!taskId) return { error: NO_TASK_ERROR }
      try {
        const inserted = await db
          .insert(schema.approval)
          .values({
            workspaceId: context.workspaceId,
            taskId,
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
          taskId,
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

export function toRunTaskContext(row: Task): RunTaskContext {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    plan: row.plan,
    summary: row.summary,
  }
}

// Static half of the task prompt: identical for every task run, so it lives in
// the instructions and stays inside the cached prompt prefix. The task's own
// title/goal/status/plan are volatile and ride the conversation snapshot
// instead — see taskStateSection. `active` picks the framing: working an
// existing task vs a thread that can become one via start_task.
export function taskRulesSection(
  artifactsEnabled: boolean,
  active: boolean
): string {
  const framing = active
    ? [
        "## Active task",
        "You are working a delegated task for the team — not answering a one-off question. The task's title, goal, and current plan appear at the end of the conversation below.",
      ]
    : [
        "## Tasks",
        "This thread can host a tracked task. When a request here amounts to delegated multi-step work with a deliverable outcome — produce or transform files, analyze data and deliver results, write a document or report — call start_task with a title, the goal, and your initial plan before diving in; the team then watches the task card live. A question is never a task, even a hard one. Code changes and recurring/scheduled work have their own tools and are never tasks.",
      ]
  return [
    ...framing,
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
