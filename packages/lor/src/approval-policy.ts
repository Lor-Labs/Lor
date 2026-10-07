import { type ApprovalTarget, approvalTargetKey } from "@repo/connectors"
import { db, eq, schema } from "@repo/db"
import type { ToolSet } from "ai"
import { logger } from "./logger"
import { type OnPlanUpdated, updatePlan } from "./plans"

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
// no entry (messaging/reactions, brain, chat search, plan/loop bookkeeping)
// can never be gated — answering in chat is the core product.
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
// LOR_TOOL_APPROVAL_SECRET is set).
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
//
// `canPark` (voice runs): when nobody present can resolve the approval, the
// call is denied with a reason the model reads and passes on.
export function buildToolApproval(
  gates: ApprovalGates,
  targets: ToolTargetMap,
  canPark?: (target: string) => Promise<boolean>
) {
  if (gates.size === 0) return undefined
  return async ({ toolCall }: { toolCall: { toolName: string } }) => {
    const target = targets.targetFor(toolCall.toolName)
    if (!target || !gates.has(target)) return "not-applicable" as const
    if (canPark && !(await canPark(target))) {
      logger.info(
        { tool: toolCall.toolName, target },
        "Lor tool call denied: no approver in the call"
      )
      return {
        type: "denied" as const,
        reason:
          "This action needs approval, and no one in this call can approve it. Say so in Lor's window; someone who can approve can join the call, or it can be done from chat.",
      }
    }
    logger.info(
      { tool: toolCall.toolName, target },
      "Lor tool call parked for approval"
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
  planId,
  parked,
  label,
  onPlanUpdated,
  notifyWorkspaceActivity,
}: {
  workspaceId: string
  runId: string
  planId: string | null
  parked: ParkedApproval
  label: string
  onPlanUpdated?: OnPlanUpdated
  // Host-supplied sidebar invalidation for plan-less parks — with a plan, the
  // waiting_for_approval status write below already notifies via onPlanUpdated.
  notifyWorkspaceActivity?: (workspaceId: string) => void
}): Promise<boolean> {
  try {
    const inserted = await db
      .insert(schema.approval)
      .values({
        workspaceId,
        runId,
        planId,
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
    if (planId) {
      await updatePlan(
        planId,
        { status: "waiting_for_approval" },
        onPlanUpdated
      )
    } else {
      notifyWorkspaceActivity?.(workspaceId)
    }
    return true
  } catch (err) {
    logger.error({ err, runId }, "Filing parked approval failed")
    return false
  }
}
