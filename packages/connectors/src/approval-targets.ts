import type { MerlinCapability } from "@repo/db/schema"
import { CAPABILITIES } from "./registry"

// Approval-target vocabulary (LOR-81). A target is one switch on the approval
// policy page: coarse per capability (reads included), per custom tool, per
// MCP server, plus core actions. The string key form is what approval_policy
// and approval rows store.
export type ApprovalCoreTarget = "messaging"

export type ApprovalTarget =
  | { kind: "capability"; capability: MerlinCapability }
  | { kind: "customTool"; customToolId: string }
  | { kind: "mcpServer"; mcpServerId: string }
  | { kind: "core"; core: ApprovalCoreTarget }

// The custom_tools capability is agent-profile grant vocabulary, not an
// approval unit — per custom_tool / mcp_server targets replace it here.
export const APPROVAL_CAPABILITY_TARGETS = (
  Object.keys(CAPABILITIES) as MerlinCapability[]
).filter((capability) => capability !== "custom_tools")

export const APPROVAL_CORE_TARGETS: Record<
  ApprovalCoreTarget,
  { label: string; description: string }
> = {
  messaging: {
    label: "Channel messaging",
    description: "Post channel messages and add reactions",
  },
}

export function approvalTargetKey(target: ApprovalTarget): string {
  switch (target.kind) {
    case "capability":
      return `capability:${target.capability}`
    case "customTool":
      return `custom_tool:${target.customToolId}`
    case "mcpServer":
      return `mcp_server:${target.mcpServerId}`
    case "core":
      return `core:${target.core}`
  }
}

export function parseApprovalTargetKey(value: string): ApprovalTarget | null {
  const separator = value.indexOf(":")
  if (separator <= 0) return null
  const kind = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  if (!rest) return null

  switch (kind) {
    case "capability": {
      if (rest === "custom_tools" || !Object.hasOwn(CAPABILITIES, rest)) {
        return null
      }
      return { kind: "capability", capability: rest as MerlinCapability }
    }
    case "custom_tool":
      return { kind: "customTool", customToolId: rest }
    case "mcp_server":
      return { kind: "mcpServer", mcpServerId: rest }
    case "core": {
      if (!Object.hasOwn(APPROVAL_CORE_TARGETS, rest)) return null
      return { kind: "core", core: rest as ApprovalCoreTarget }
    }
    default:
      return null
  }
}
