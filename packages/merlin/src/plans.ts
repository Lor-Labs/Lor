import { and, db, eq, isNull, or, schema } from "@repo/db"
import type { AgentRunContextPlan, Plan, PlanStep } from "@repo/db/schema"
import type { RealtimePlan } from "@repo/realtime-types/events"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"
import type { Exact, SerializedDates } from "./wire-guard"

// The single plan-row → wire-type mapping (used by every plan:updated emit
// across api/worker/realtime — previously three drifting copies).
// Drift guard (see wire-guard.ts): RealtimePlan must stay the exact
// date-serialized mirror of the plan row, minus deliberate omissions.
type OffWirePlanColumns =
  // Spawn provenance (Act/loop runs) — server-side lineage, no card renders
  // it; the loop run UI queries it, never receives it over the socket.
  "originRunId"
const _realtimePlanMirrorsDbRow: Exact<
  Omit<SerializedDates<Plan>, OffWirePlanColumns>,
  RealtimePlan
> = true
void _realtimePlanMirrorsDbRow

export function toRealtimePlan(row: Plan): RealtimePlan {
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
    steps: row.steps,
    summary: row.summary,
    activeRunId: row.activeRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const MAX_STEPS = 30
const MAX_STEP_CHARS = 200
// Deliberately tight: the card renders this as a single muted line under the
// step, so it has to stay one clause rather than a paragraph.
const MAX_DESCRIPTION_CHARS = 120
// The card clamps the summary to three lines (~270 chars at its max width), so
// anything longer is written to be truncated. Detail belongs in Merlin's final
// message, where the team can actually read it.
const MAX_SUMMARY_CHARS = 300

export type OnPlanUpdated = (plan: Plan) => void

// start_plan creation is delegated to the host (the worker posts the card
// message and inserts the row — message fanout machinery lives there).
export type StartPlanInput = {
  title: string
  goal: string
  steps: PlanStep[]
}
export type CreatePlanForThread = (
  input: StartPlanInput
) => Promise<Plan | null>

// Plan id resolves through a getter, not a static value: a plan created by
// start_plan mid-run must be visible to update_plan/complete_plan/
// request_approval bound in the same respond() call (tool contexts are
// resolved eagerly). The SDK runs a step's tool calls concurrently, so a
// sibling batched with start_plan errors — the error text + prompt steer the
// model to call start_plan alone and retry (observed to self-correct).
const planContext = z.object({
  getPlanId: z.custom<() => string | null>(),
  // Grants ONE reopen per run, and only when the run began on an
  // already-completed plan — a same-run complete_plan then update_plan must
  // not resurrect what it just settled, and neither may a second reopen cycle.
  consumeReopen: z.custom<() => boolean>().optional(),
  workspaceId: z.string(),
  runId: z.string().nullable(),
  onPlanUpdated: z.custom<OnPlanUpdated>().optional(),
  // Lets respond() force a final text step once an approval is pending.
  onApprovalRequested: z.custom<() => void>().optional(),
})

const NO_PLAN_ERROR =
  "no plan exists for this thread yet — call start_plan first, wait for its result, then call this tool (never in the same parallel batch as start_plan)"

// Settle the plan a run leaves behind when it dies outside its processor
// (crash swept by sweepDeadRuns, stopped while still queued, or a first run
// that never got enqueued). Keys on the claimed run id, or — for a run that
// never claimed — the plan anchored to the run's thread root, guarded on
// activeRunId being unset so a newer continuation's plan is never clobbered.
// Active steps demote to pending so the card stops showing a spinning step
// (complete_plan normalizes the steps on success; abnormal ends must too).
export async function settleAbandonedRunPlan(
  run: { id?: string; threadRootId: string | null },
  status: "failed" | "stopped",
  onPlanUpdated?: OnPlanUpdated
): Promise<void> {
  const linkage = or(
    run.id ? eq(schema.plan.activeRunId, run.id) : undefined,
    run.threadRootId
      ? and(
          eq(schema.plan.threadRootId, run.threadRootId),
          isNull(schema.plan.activeRunId)
        )
      : undefined
  )
  if (!linkage) return
  const target = await db
    .select({ id: schema.plan.id, steps: schema.plan.steps })
    .from(schema.plan)
    .where(and(eq(schema.plan.status, "running"), linkage))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!target) return
  const steps = target.steps.map((item) =>
    item.status === "active" ? { ...item, status: "pending" as const } : item
  )
  const row = await db
    .update(schema.plan)
    .set({ status, activeRunId: null, steps })
    .where(
      and(
        eq(schema.plan.id, target.id),
        eq(schema.plan.status, "running"),
        linkage
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (row && onPlanUpdated) {
    try {
      onPlanUpdated(row)
    } catch (err) {
      logger.error({ err }, "onPlanUpdated listener failed")
    }
  }
}

// `observedStatus` is a CAS guard (same idiom as the worker's settlePlan): the
// write lands only if the status still matches what the caller read, so a
// concurrent complete_plan can't be overwritten by a stale steps snapshot.
export async function updatePlan(
  planId: string,
  values: Partial<typeof schema.plan.$inferInsert>,
  onPlanUpdated?: OnPlanUpdated,
  observedStatus?: Plan["status"]
): Promise<Plan | null> {
  const row = await db
    .update(schema.plan)
    .set(values)
    .where(
      and(
        eq(schema.plan.id, planId),
        observedStatus ? eq(schema.plan.status, observedStatus) : undefined
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (row && onPlanUpdated) {
    try {
      onPlanUpdated(row)
    } catch (err) {
      logger.error({ err }, "onPlanUpdated listener failed")
    }
  }
  return row
}

const stepSchema = z.object({
  text: z.string().min(1).max(MAX_STEP_CHARS),
  status: z.enum(["pending", "active", "done"]),
  // Nullable rather than optional to stay valid under `strict: true`, which
  // requires every property to be present. Nulls are dropped on the way in.
  description: z.string().max(MAX_DESCRIPTION_CHARS).nullable(),
})

// Trims labels and drops whitespace-only steps — zod's min(1) passes " ".
function normalizeSteps(items: z.infer<typeof stepSchema>[]): PlanStep[] {
  const normalized: PlanStep[] = []
  for (const { text, status, description } of items) {
    const label = text.trim()
    if (!label) continue
    const detail = description?.trim()
    normalized.push(
      detail
        ? { text: label, status, description: detail }
        : { text: label, status }
    )
  }
  return normalized
}

const startPlanContext = z.object({
  getPlanId: z.custom<() => string | null>(),
  createPlan: z.custom<CreatePlanForThread>().optional(),
})

export const planTools = {
  start_plan: tool({
    description:
      "Turn this thread's request into a tracked plan: a live card the team watches while you work. Call it BEFORE starting substantial delegated work with a deliverable outcome — produce or transform files, analyze data and deliver results, write a document or report, complete multi-step work. Never for questions (even hard ones), quick answers, code changes (propose_code_change handles those), or recurring/scheduled work (loop tools handle those). Pass a short imperative title like an issue title, the goal in one or two sentences, and your initial steps. Call it ALONE and wait for its result before any other plan tool — update_plan/complete_plan in the same parallel batch will fail.",
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
      steps: z.array(stepSchema).min(1).max(MAX_STEPS),
    }),
    contextSchema: startPlanContext,
    execute: async ({ title, goal, steps }, { context }) => {
      if (context.getPlanId()) {
        return { error: "a plan already exists for this thread" }
      }
      if (!context.createPlan) {
        return { error: "plans can't be started from this context" }
      }
      const trimmedTitle = title.trim()
      const trimmedGoal = goal.trim()
      const items = normalizeSteps(steps)
      if (!trimmedTitle || !trimmedGoal || items.length === 0) {
        return { error: "title, goal, and steps must not be blank" }
      }
      const row = await context.createPlan({
        title: trimmedTitle,
        goal: trimmedGoal,
        steps: items,
      })
      if (!row) return { error: "couldn't start the plan" }
      return {
        ok: true,
        planId: row.id,
        note: "plan started — the team sees the card and steps live; keep it current with update_plan and finish with complete_plan",
      }
    },
    strict: true,
  }),

  update_plan: tool({
    description:
      "Replace the plan's step checklist — the team sees it live on the plan card. Call it when you first break the work down, and again whenever a step's status changes (mark steps done as you finish them, active while you work on them). Pass the FULL list of steps every time; it replaces the previous one. A step may carry a `description`: ONE short clause (under 120 chars) adding context the label itself doesn't convey — pass null for every other step, which is most of them. Preserve the descriptions already on the steps when you resend them.",
    inputSchema: z.object({
      steps: z.array(stepSchema).min(1).max(MAX_STEPS),
    }),
    contextSchema: planContext,
    execute: async ({ steps }, { context }) => {
      const planId = context.getPlanId()
      if (!planId) return { error: NO_PLAN_ERROR }
      const items = normalizeSteps(steps)
      if (items.length === 0) return { error: "steps must not be blank" }
      const current = await db
        .select({ status: schema.plan.status })
        .from(schema.plan)
        .where(eq(schema.plan.id, planId))
        .limit(1)
        .then((rows) => rows[0])
      if (!current) return { error: "plan not found" }
      // Updating a plan that was ALREADY completed when this run started is
      // the explicit reopen — follow-up chatter never flips it (the worker
      // claim skips completed plans), and a same-run update_plan racing its
      // own complete_plan must not resurrect what it just settled. Consumed
      // on use: one reopen per run.
      const reopen =
        current.status === "completed" && context.consumeReopen?.() === true
      const row = await updatePlan(
        planId,
        {
          steps: items,
          ...(reopen
            ? { status: "running" as const, activeRunId: context.runId }
            : {}),
        },
        context.onPlanUpdated,
        current.status
      )
      if (!row) {
        return {
          error:
            "plan status changed while updating the steps (it may have just completed) — re-check the plan before retrying",
        }
      }
      return { ok: true }
    },
    strict: true,
  }),

  complete_plan: tool({
    description:
      "Mark the plan completed, with a one-line summary of what was delivered. Call this ONLY when the work is genuinely done and the deliverables exist — never to give up (just explain instead; the plan stays open for the team). The summary is a headline on the plan card, not a report: ONE sentence (two at most, 300 chars hard limit) naming what the team now has and anything they must know. No methodology, no per-file walkthrough, no restating counts or filenames — delivered files are already linked on the card. Put the detail in the final message you write straight after this call.",
    inputSchema: z.object({
      summary: z
        .string()
        .min(1)
        .max(MAX_SUMMARY_CHARS)
        .describe(
          "one sentence, headline style — what was delivered and any caveat"
        ),
    }),
    contextSchema: planContext,
    execute: async ({ summary }, { context }) => {
      const planId = context.getPlanId()
      if (!planId) return { error: NO_PLAN_ERROR }
      // Completing the plan settles the checklist: the model routinely forgets
      // a final update_plan, which left cards showing a spinning step forever.
      const current = await db
        .select({ status: schema.plan.status, steps: schema.plan.steps })
        .from(schema.plan)
        .where(eq(schema.plan.id, planId))
        .limit(1)
        .then((rows) => rows[0])
      if (!current) return { error: "plan not found" }
      const steps = current.steps.map((item) =>
        item.status === "done" ? item : { ...item, status: "done" as const }
      )
      const row = await updatePlan(
        planId,
        { status: "completed", summary, steps },
        context.onPlanUpdated,
        current.status
      )
      if (!row) {
        return {
          error:
            "plan status changed while completing — re-check the plan's current state",
        }
      }
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
    contextSchema: planContext,
    execute: async ({ action, description }, { context }) => {
      const planId = context.getPlanId()
      if (!planId) return { error: NO_PLAN_ERROR }
      try {
        const inserted = await db
          .insert(schema.approval)
          .values({
            workspaceId: context.workspaceId,
            planId,
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
              "an approval is already pending on this plan; wait for it to be resolved",
          }
        }
        await updatePlan(
          planId,
          { status: "waiting_for_approval" },
          context.onPlanUpdated
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

// The context of the plan a run belongs to, threaded from the worker.
export type RunPlanContext = {
  id: string
  title: string
  goal: string
  status: Plan["status"]
  steps: PlanStep[]
  summary: string | null
}

export function toRunPlanContext(row: Plan): RunPlanContext {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    steps: row.steps,
    summary: row.summary,
  }
}

// Static half of the plan prompt: identical for every plan run, so it lives in
// the instructions and stays inside the cached prompt prefix. The plan's own
// title/goal/status/steps are volatile and ride the conversation snapshot
// instead — see planStateSection. `active` picks the framing: working an
// existing plan vs a thread that can start one via start_plan.
export function planRulesSection(
  artifactsEnabled: boolean,
  active: boolean
): string {
  const framing = active
    ? [
        "## Active plan",
        "You are working a delegated plan for the team — not answering a one-off question. The plan's title, goal, and current steps appear at the end of the conversation below.",
      ]
    : [
        "## Plans",
        "This thread can host a tracked plan. When a request here amounts to delegated multi-step work with a deliverable outcome — produce or transform files, analyze data and deliver results, write a document or report — call start_plan with a title, the goal, and your initial steps before diving in; the team then watches the plan card live. Call start_plan alone and wait for its result before any other plan tool. A question never needs a plan, even a hard one. Code changes and recurring/scheduled work have their own tools and never get a plan.",
      ]
  return [
    ...framing,
    "",
    "Plan rules:",
    "- Keep the steps current with update_plan: set them when you start, mark them done as you finish them. The team watches the card live.",
    ...(artifactsEnabled
      ? [
          "- Produce real deliverables with create_artifacts; share their links.",
        ]
      : []),
    "- Before consequential external actions (writes to third-party tools), call request_approval and stop; act only after a human approves.",
    "- When the work is fully done, call complete_plan with a summary. If you need input from the team, ask and end your message — the plan waits for their reply.",
    "- complete_plan's summary is a one-sentence headline for the card — keep the detail for the message you write after it.",
    "- Anyone on the team may reply with new instructions while a plan is open; treat the newest instruction as authoritative.",
  ].join("\n")
}

// Volatile half: rendered at the tail of the initial user message, where a
// change costs only the tail of the prompt rather than invalidating all of it.
export function planStateSection(plan: AgentRunContextPlan): string {
  const steps = plan.steps.length
    ? plan.steps
        .map(
          (i) =>
            `- [${i.status}] ${i.text}${i.description ? ` — ${i.description}` : ""}`
        )
        .join("\n")
    : "(no steps yet)"
  return [
    "\n\n## Your active plan",
    `Plan: "${plan.title}" (status: ${plan.status}).`,
    `Goal: ${plan.goal}`,
    ...(plan.summary ? [`Summary so far: ${plan.summary}`] : []),
    `Current steps:\n${steps}`,
  ].join("\n")
}

export function planContextSnapshot(plan: RunPlanContext): AgentRunContextPlan {
  return {
    title: plan.title,
    goal: plan.goal,
    status: plan.status,
    steps: plan.steps,
    summary: plan.summary,
  }
}
