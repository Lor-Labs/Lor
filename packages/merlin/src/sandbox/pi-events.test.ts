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
    const collector = createPiEventCollector(onStep)

    collector.consume("not json")
    collector.consume("")
    collector.consume(
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "grep",
        args: { pattern: "investigateCode" },
      })
    )

    expect(onStep).toHaveBeenCalledWith({
      toolName: "grep",
      label: "Searched for “investigateCode”",
    })
    expect(collector.result()).toEqual({
      findings: "",
      usage: undefined,
      error: undefined,
    })
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
        outputTokens: 55,
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
