import { describe, expect, it, vi } from "vitest"
import { createPiEventCollector, piToolLabel } from "./pi-events"

function assistantEvent(options: {
  model?: string
  responseModel?: string
  text?: string
  errorMessage?: string
  usage?: Record<string, number>
}) {
  return JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      model: options.model,
      responseModel: options.responseModel,
      errorMessage: options.errorMessage,
      content: options.text ? [{ type: "text", text: options.text }] : [],
      usage: options.usage,
    },
  })
}

function toolStart(toolName: string, args: unknown, toolCallId = "tc-1") {
  return JSON.stringify({
    type: "tool_execution_start",
    toolCallId,
    toolName,
    args,
  })
}

describe("piToolLabel", () => {
  it("turns Pi's read-only tools into human-readable progress", () => {
    expect(piToolLabel("read", { path: "src/index.ts" })).toBe(
      "Read src/index.ts"
    )
    expect(piToolLabel("grep", { pattern: "investigateCode" })).toBe(
      "Searched for “investigateCode”"
    )
    expect(piToolLabel("find", { pattern: "**/*.ts" })).toBe(
      "Listed files: **/*.ts"
    )
    expect(piToolLabel("ls", { path: "src" })).toBe("Listed src")
  })
})

describe("createPiEventCollector", () => {
  it("ignores non-events and reports tool execution", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })

    collector.consume("not json")
    collector.consume("")
    collector.consume(toolStart("grep", { pattern: "investigateCode" }))

    expect(onStep).toHaveBeenCalledWith({
      toolCallId: "tc-1",
      toolName: "grep",
      label: "Searched for “investigateCode”",
    })
    expect(collector.result()).toEqual({
      findings: "",
      usage: undefined,
      error: undefined,
    })
  })

  it("consumes newline-stripped Blaxel callbacks as they arrive", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })

    collector.consumeOutput(toolStart("read", { path: "src/index.ts" }, "a"))
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "a",
      toolName: "read",
      label: "Read src/index.ts",
    })

    collector.consumeOutput(
      `${toolStart("ls", { path: "src" }, "b")}\n${toolStart("read", { path: "x" }, "c")}`
    )
    expect(onStep).toHaveBeenCalledTimes(3)
  })

  it("presents a successful write as an all-added diff on the end event", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })

    collector.consume(
      toolStart("write", { path: "out/code.py", content: "a\nb\nc\n" })
    )
    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "tc-1",
      toolName: "write",
      label: "Wrote out/code.py",
    })

    collector.consume(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "write",
        isError: false,
        result: { content: [{ type: "text", text: "Successfully wrote" }] },
      })
    )
    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "tc-1",
      toolName: "write",
      label: "Wrote out/code.py",
      status: "ok",
      diff: {
        path: "out/code.py",
        additions: 3,
        deletions: 0,
        patch: "+a\n+b\n+c",
      },
    })
  })

  it("never emits a diff for a failed write", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })

    collector.consume(toolStart("write", { path: "out/x", content: "a\n" }))
    collector.consume(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "write",
        isError: true,
        result: { content: [{ type: "text", text: "permission denied" }] },
      })
    )

    for (const [step] of onStep.mock.calls) {
      expect(step).not.toHaveProperty("diff")
    }
    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "tc-1",
      toolName: "write",
      label: "Wrote out/x",
      status: "error",
    })
  })

  it("reports completion status and the computed edit diff on the end event", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })
    // The added "+++counter" line is a source line starting with "++" — only
    // the pre-hunk file headers may be excluded from the counts.
    const patch =
      "--- a/out/code.py\n+++ b/out/code.py\n@@ -1,3 +1,3 @@\n-old\n-older\n+new\n+++counter\n context"

    collector.consume(
      toolStart("edit", {
        path: "out/code.py",
        edits: [{ oldText: "old", newText: "new" }],
      })
    )
    collector.consume(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "edit",
        isError: false,
        result: { details: { patch } },
      })
    )

    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "tc-1",
      toolName: "edit",
      label: "Edited out/code.py",
      status: "ok",
      diff: { path: "out/code.py", additions: 2, deletions: 2, patch },
    })
  })

  it("marks a failed tool call without a diff", () => {
    const onStep = vi.fn()
    const collector = createPiEventCollector({ onStep })

    collector.consume(toolStart("edit", { path: "x", edits: [] }))
    collector.consume(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "edit",
        isError: true,
        result: { content: [{ type: "text", text: "oldText not found" }] },
      })
    )

    expect(onStep).toHaveBeenLastCalledWith({
      toolCallId: "tc-1",
      toolName: "edit",
      label: "Edited x",
      status: "error",
    })
  })

  it("streams assistant text snapshots, resetting per message", () => {
    const onAssistantText = vi.fn()
    const collector = createPiEventCollector({ onAssistantText })
    const delta = (text: string) =>
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: text,
        },
      })
    const start = (role: string) =>
      JSON.stringify({ type: "message_start", message: { role } })

    collector.consume(start("assistant"))
    collector.consume(delta("Looking at"))
    collector.consume(delta(" the code."))
    collector.consume(assistantEvent({ text: "Looking at the code." }))
    collector.consume(start("toolResult"))
    collector.consume(delta("ignored"))
    collector.consume(start("assistant"))
    collector.consume(delta("Final answer."))

    // The empty snapshot marks the message boundary (reset signal).
    expect(onAssistantText.mock.calls.map((c) => c[0])).toEqual([
      "Looking at",
      "Looking at the code.",
      "",
      "Final answer.",
    ])
  })

  it("keeps the final answer and accumulates usage across assistant turns", () => {
    const collector = createPiEventCollector()
    collector.consume(
      assistantEvent({
        model: "moonshotai/kimi-k3",
        responseModel: "moonshotai/kimi-k3-202607",
        text: "I need to inspect one more file.",
        usage: {
          input: 100,
          cacheRead: 20,
          output: 30,
          reasoning: 10,
        },
      })
    )
    collector.consume(
      assistantEvent({
        model: "moonshotai/kimi-k3",
        responseModel: "moonshotai/kimi-k3-202607",
        text: "The final answer.",
        usage: {
          input: 80,
          cacheRead: 50,
          output: 25,
          reasoning: 5,
        },
      })
    )

    expect(collector.result()).toEqual({
      findings: "The final answer.",
      error: undefined,
      usage: {
        model: "moonshotai/kimi-k3-202607",
        requestedModel: "moonshotai/kimi-k3",
        inputTokens: 180,
        cachedInputTokens: 70,
        outputTokens: 70,
        reasoningTokens: 15,
      },
    })
  })

  it("captures an assistant error without inventing findings", () => {
    const collector = createPiEventCollector()
    collector.consume(
      assistantEvent({
        model: "moonshotai/kimi-k3",
        errorMessage: "gateway request failed",
      })
    )

    expect(collector.result()).toMatchObject({
      findings: "",
      error: "gateway request failed",
    })
  })
})
