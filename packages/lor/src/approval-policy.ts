import {
  type ApprovalTarget,
  approvalTargetKey,
  builtinApprovalTool,
  parseApprovalTargetKey,
} from "@repo/connectors"
import { db, eq, schema } from "@repo/db"
import type { ToolSet } from "ai"
import { logger } from "./logger"

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
  // A key that doesn't parse (e.g. a renamed catalog tool) can never match a
  // bound tool, so skipping it gates nothing less. Settings list it under
  // "Unavailable tools" for removal.
  const supported = rows.filter((row) => {
    if (parseApprovalTargetKey(row.target)) return true
    logger.warn(
      { workspaceId, policyId: row.id, target: row.target },
      "Skipping unsupported approval policy target"
    )
    return false
  })
  return new Map(supported.map((row) => [row.target, { policyId: row.id }]))
}

// Maps each bound tool name to the approval target that governs it. Tools with
// no entry (messaging/reactions, brain, chat search, plan/loop bookkeeping)
// can never be gated — answering in chat is the core product.
export class ToolTargetMap {
  private readonly byToolName = new Map<string, string>()

  addBuiltins(tools: ToolSet | Record<string, unknown>) {
    for (const name of Object.keys(tools)) {
      if (builtinApprovalTool(name))
        this.addName(name, { kind: "builtinTool", toolName: name })
    }
  }

  addName(toolName: string, target: ApprovalTarget) {
    this.byToolName.set(toolName, approvalTargetKey(target))
  }

  targetFor(toolName: string): string | null {
    return this.byToolName.get(toolName) ?? null
  }
}
