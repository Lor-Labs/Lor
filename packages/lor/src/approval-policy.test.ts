import { describe, expect, it } from "vitest"
import {
  type ApprovalGates,
  buildToolApproval,
  ToolTargetMap,
} from "./approval-policy"

const gates = (...targets: string[]): ApprovalGates =>
  new Map(targets.map((target) => [target, { policyId: `policy-${target}` }]))

describe("ToolTargetMap", () => {
  it("maps tool sets, custom tools and MCP servers to target keys", () => {
    const targets = new ToolTargetMap()
    targets.add(
      { create_linear_issue: {}, update_linear_issue: {} },
      { kind: "capability", capability: "linear_write" }
    )
    targets.addName("page_oncall", { kind: "customTool", customToolId: "ct-1" })
    targets.addName("sentry_issues", {
      kind: "mcpServer",
      mcpServerId: "mcp-1",
    })

    expect(targets.targetFor("create_linear_issue")).toBe(
      "capability:linear_write"
    )
    expect(targets.targetFor("update_linear_issue")).toBe(
      "capability:linear_write"
    )
    expect(targets.targetFor("page_oncall")).toBe("custom_tool:ct-1")
    expect(targets.targetFor("sentry_issues")).toBe("mcp_server:mcp-1")
    // Core tools (messaging, brain, chat search) are unmapped — never gateable
    expect(targets.targetFor("post_channel_message")).toBeNull()
    expect(targets.targetFor("search_brain")).toBeNull()
  })
})

describe("buildToolApproval", () => {
  const targets = new ToolTargetMap()
  targets.add(
    { create_linear_issue: {} },
    { kind: "capability", capability: "linear_write" }
  )
  targets.add(
    { search_linear: {} },
    { kind: "capability", capability: "linear" }
  )
  targets.addName("page_oncall", { kind: "customTool", customToolId: "ct-1" })

  it("is undefined when the workspace opted into nothing", () => {
    expect(buildToolApproval(gates(), targets)).toBeUndefined()
  })

  it("parks only tools whose target has a policy row", async () => {
    const gate = buildToolApproval(gates("capability:linear_write"), targets)
    expect(gate).toBeDefined()
    expect(
      await gate?.({ toolCall: { toolName: "create_linear_issue" } })
    ).toBe("user-approval")
    // same connector, different capability — reads stay ungated
    expect(await gate?.({ toolCall: { toolName: "search_linear" } })).toBe(
      "not-applicable"
    )
    expect(await gate?.({ toolCall: { toolName: "page_oncall" } })).toBe(
      "not-applicable"
    )
    // unmapped core tool
    expect(await gate?.({ toolCall: { toolName: "search_brain" } })).toBe(
      "not-applicable"
    )
  })

  it("gates a single custom tool without touching the rest", async () => {
    const gate = buildToolApproval(gates("custom_tool:ct-1"), targets)
    expect(await gate?.({ toolCall: { toolName: "page_oncall" } })).toBe(
      "user-approval"
    )
    expect(
      await gate?.({ toolCall: { toolName: "create_linear_issue" } })
    ).toBe("not-applicable")
  })
})
