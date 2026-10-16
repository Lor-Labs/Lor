import type { ProfileToolGroup } from "./profile-tools"
import { CONNECTORS } from "./registry"
import { builtinApprovalTool } from "./tools"

// Core messaging, memory, and run bookkeeping are never gateable.
export type ApprovalTarget =
  | { kind: "builtinTool"; toolName: string }
  | { kind: "customTool"; customToolId: string }
  | { kind: "mcpTool"; mcpServerId: string; toolName: string }

export const APPROVAL_TARGET_MAX_LENGTH = 2048
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function approvalTargetKey(target: ApprovalTarget): string {
  switch (target.kind) {
    case "builtinTool":
      return `tool:${target.toolName}`
    case "customTool":
      return `custom_tool:${target.customToolId}`
    case "mcpTool":
      return `mcp_tool:${target.mcpServerId}:${encodeURIComponent(target.toolName)}`
  }
}

export function parseApprovalTargetKey(value: string): ApprovalTarget | null {
  if (value.length > APPROVAL_TARGET_MAX_LENGTH) return null
  const separator = value.indexOf(":")
  if (separator <= 0) return null
  const kind = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  switch (kind) {
    case "tool":
      return builtinApprovalTool(rest)
        ? { kind: "builtinTool", toolName: rest }
        : null
    case "custom_tool":
      return uuid.test(rest) ? { kind: "customTool", customToolId: rest } : null
    case "mcp_tool": {
      const split = rest.indexOf(":")
      const mcpServerId = rest.slice(0, split)
      if (split < 0 || !uuid.test(mcpServerId)) return null
      try {
        const encoded = rest.slice(split + 1)
        const toolName = decodeURIComponent(encoded)
        if (
          !toolName.trim() ||
          toolName.length > 128 ||
          encodeURIComponent(toolName) !== encoded
        )
          return null
        return { kind: "mcpTool", mcpServerId, toolName }
      } catch {
        return null
      }
    }
    default:
      return null
  }
}

// Names come from the workspace catalog when the caller has it; without it,
// custom tools fall back to "an API tool" rather than a raw id.
export function approvalTargetLabel(
  key: string,
  groups: readonly Pick<ProfileToolGroup, "kind" | "id" | "name">[] = [],
  customTools: readonly { id: string; name: string }[] = []
): string {
  const target = parseApprovalTargetKey(key)
  if (!target) return key
  switch (target.kind) {
    case "builtinTool": {
      const tool = builtinApprovalTool(target.toolName)
      if (!tool) return key
      return tool.provider
        ? `${CONNECTORS[tool.provider].label} · ${tool.label}`
        : tool.label
    }
    case "customTool":
      return (
        customTools.find((tool) => tool.id === target.customToolId)?.name ??
        "an API tool"
      )
    case "mcpTool": {
      const server = groups.find(
        (group) => group.kind === "mcpServer" && group.id === target.mcpServerId
      )
      return server ? `${server.name} · ${target.toolName}` : target.toolName
    }
  }
}
