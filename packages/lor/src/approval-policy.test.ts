import { describe, expect, it } from "vitest"
import { ToolTargetMap } from "./approval-policy"

describe("ToolTargetMap", () => {
  it("maps tool sets, custom tools and MCP servers to target keys", () => {
    const targets = new ToolTargetMap()
    targets.addBuiltins({ create_linear_issue: {}, update_linear_issue: {} })
    targets.addName("page_oncall", { kind: "customTool", customToolId: "ct-1" })
    targets.addName("sentry_issues", {
      kind: "mcpTool",
      toolName: "sentry_issues",
      mcpServerId: "mcp-1",
    })

    expect(targets.targetFor("create_linear_issue")).toBe(
      "tool:create_linear_issue"
    )
    expect(targets.targetFor("update_linear_issue")).toBe(
      "tool:update_linear_issue"
    )
    expect(targets.targetFor("page_oncall")).toBe("custom_tool:ct-1")
    expect(targets.targetFor("sentry_issues")).toBe(
      "mcp_tool:mcp-1:sentry_issues"
    )
    // Core tools (messaging, brain, chat search) are unmapped — never gateable
    expect(targets.targetFor("post_channel_message")).toBeNull()
    expect(targets.targetFor("search_brain")).toBeNull()
  })
})
