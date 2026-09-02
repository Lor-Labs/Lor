import { type ApprovalTarget, approvalTargetKey } from "@repo/connectors"
import { db, eq, schema } from "@repo/db"
import type { Task } from "@repo/db/schema"
import type { ToolSet } from "ai"
import { logger } from "./logger"
import { updateTask } from "./tasks"

// Which tool targets this workspace gates behind human approval (LOR-81).
// Computed model: a row exists only where the workspace opted in, so an empty
// map means no gates. Never caught — a policy read failure must fail the run
// rather than silently executing gated actions ungated.
export type ApprovalGates = Map<string, { policyId: string }>

export async function loadApprovalGates(
  workspaceId: string
): Promise<ApprovalGates> {
  const rows = await db
    .select({
      id: schema.approvalPolicy.id,
      target: schema.approvalPolicy.target,
    })
    .from(schema.approvalPolicy)
    .where(eq(schema.approvalPolicy.workspaceId, workspaceId))
  return new Map(rows.map((row) => [row.target, { policyId: row.id }]))
}

// Maps each bound tool name to the approval target that governs it. Tools with
// no entry (brain, chat search, task/loop bookkeeping) can never be gated.
export class ToolTargetMap {
  private readonly byToolName = new Map<string, string>()

  add(tools: ToolSet | Record<string, unknown>, target: ApprovalTarget) {
    const key = approvalTargetKey(target)
    for (const name of Object.keys(tools)) {
      this.byToolName.set(name, key)
    }
  }

  addName(toolName: string, target: ApprovalTarget) {
    this.byToolName.set(toolName, approvalTargetKey(target))
  }

  targetFor(toolName: string): string | null {
    return this.byToolName.get(toolName) ?? null
  }
}

// The parked call: what a resolver approves and what executes verbatim on
// resume (the SDK re-validates input + policy, and the HMAC signature when
// MERLIN_TOOL_APPROVAL_SECRET is set).
export type ParkedApproval = {
  approvalId: string
  toolCallId: string
  toolName: string
  target: string
  input: unknown
}

// Gated calls stop the loop: the SDK emits tool-approval-request instead of
// executing, and the step's client tool calls never all resolve, so streamText
// finishes without another model call. Ungated sibling calls in the same step
// still execute — a parked step can carry real side effects.
export function buildToolApproval(
  gates: ApprovalGates,
  targets: ToolTargetMap
) {
  if (gates.size === 0) return undefined
  return ({ toolCall }: { toolCall: { toolName: string } }) => {
    const target = targets.targetFor(toolCall.toolName)
    if (!target || !gates.has(target)) return "not-applicable" as const
    logger.info(
      { tool: toolCall.toolName, target },
      "Merlin tool call parked for approval"
    )
    return "user-approval" as const
  }
}

// Persist the park. Called after the parked step is checkpointed, so the
// transcript the continuation replays already contains the tool call this row
// authorizes. The partial unique index on (run_id) where pending makes a
// double file a no-op rather than a second gate on the same run.
export async function fileParkedApproval({
  workspaceId,
  runId,
  taskId,
  parked,
  label,
  onTaskUpdated,
}: {
  workspaceId: string
  runId: string
  taskId: string | null
  parked: ParkedApproval
  label: string
  onTaskUpdated?: (task: Task) => void
}): Promise<boolean> {
  try {
    const inserted = await db
      .insert(schema.approval)
      .values({
        workspaceId,
        runId,
        taskId,
        action: parked.target,
        description: label,
        payload: parked.input,
        toolCallId: parked.toolCallId,
        toolName: parked.toolName,
        target: parked.target,
      })
      .onConflictDoNothing()
      .returning({ id: schema.approval.id })
      .then((rows) => rows[0] ?? null)
    if (!inserted) return false
    if (taskId) {
      await updateTask(
        taskId,
        { status: "waiting_for_approval" },
        onTaskUpdated
      )
    }
    return true
  } catch (err) {
    logger.error({ err, runId }, "Filing parked approval failed")
    return false
  }
}
