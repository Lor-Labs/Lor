import type { AgentRunContextPlan } from "@repo/db/schema"
import type { ModelMessage } from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

const generateText = vi.fn()
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>()
  return {
    ...actual,
    generateText: (...a: unknown[]) => generateText(...a),
  }
})
vi.mock("./models", () => ({
  lorSmallModel: "small-model",
  smallGatewayOptions: {},
}))
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  chooseSplit,
  compact,
  estimateMessagesTokens,
  isSafeSplit,
  isStateMessage,
  isSummaryMessage,
  newCompactionState,
  renderForSummary,
  summarizeWorkingState,
  summaryMessage,
} from "./compaction"

const ok = (text: string) => ({
  text,
  response: { modelId: "zai/glm-5.3-flash" },
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    inputTokenDetails: { cacheReadTokens: 10 },
  },
})

const call = (id: string): ModelMessage =>
  ({
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: id, toolName: "run_sql", input: {} },
    ],
  }) as unknown as ModelMessage

describe("estimateMessagesTokens", () => {
  it("estimates image parts without serializing their bytes", () => {
    const small = new Uint8Array(10)
    const large = new Uint8Array(100_000)
    const message = (image: Uint8Array) =>
      ({
        role: "user",
        content: [{ type: "image", image, mediaType: "image/jpeg" }],
      }) as ModelMessage

    expect(estimateMessagesTokens([message(large)])).toBe(
      estimateMessagesTokens([message(small)])
    )
  })
})

const result = (id: string, output: unknown = { rows: 1 }): ModelMessage =>
  ({
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, toolName: "run_sql", output },
    ],
  }) as unknown as ModelMessage

const text = (role: "user" | "assistant", body: string): ModelMessage =>
  ({ role, content: body }) as ModelMessage

const bulky = (chars: number) => "x".repeat(chars)

describe("isSafeSplit", () => {
  it("rejects a split between a tool call and its result", () => {
    const messages = [text("user", "ask"), call("t1"), result("t1")]
    expect(isSafeSplit(messages, 2)).toBe(false)
  })

  it("accepts a split after the pair is closed", () => {
    const messages = [text("user", "ask"), call("t1"), result("t1")]
    expect(isSafeSplit(messages, 3)).toBe(true)
    expect(isSafeSplit(messages, 1)).toBe(true)
  })

  it("handles several interleaved calls in one assistant turn", () => {
    const two = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "x", input: {} },
        { type: "tool-call", toolCallId: "b", toolName: "x", input: {} },
      ],
    } as unknown as ModelMessage
    const messages = [text("user", "ask"), two, result("a"), result("b")]
    expect(isSafeSplit(messages, 2)).toBe(false)
    expect(isSafeSplit(messages, 3)).toBe(false)
    expect(isSafeSplit(messages, 4)).toBe(true)
  })
})

describe("chooseSplit", () => {
  it("keeps a tail of roughly the target size", () => {
    // 10 messages of ~2.5k tokens each; a 5k target should keep ~2.
    const messages = [
      text("user", "ask"),
      ...Array.from({ length: 10 }, () => text("assistant", bulky(10_000))),
    ]
    const split = chooseSplit(messages, 5_000)
    expect(messages.length - split).toBeGreaterThanOrEqual(2)
    expect(messages.length - split).toBeLessThanOrEqual(4)
  })

  it("never splits below index 1, so the original ask always survives", () => {
    const messages = [text("user", "ask"), text("assistant", "short")]
    expect(chooseSplit(messages, 1_000_000)).toBe(1)
  })

  it("slides off an unsafe boundary onto a safe one", () => {
    const messages = [
      text("user", "ask"),
      text("assistant", bulky(40_000)),
      call("t1"),
      result("t1"),
    ]
    // A raw token walk would land mid-pair; the result must be safe.
    const split = chooseSplit(messages, 1_000)
    expect(isSafeSplit(messages, split)).toBe(true)
  })
})

describe("renderForSummary", () => {
  it("renders tool calls and results with their names", () => {
    const digest = renderForSummary([call("t1"), result("t1", { rows: 2553 })])
    expect(digest).toContain("→ run_sql")
    expect(digest).toContain("← run_sql")
    expect(digest).toContain("2553")
  })

  it("truncates a huge tool result rather than sending it whole", () => {
    const digest = renderForSummary([result("t1", { blob: bulky(50_000) })])
    expect(digest).toContain("[truncated]")
    expect(digest.length).toBeLessThan(10_000)
  })
})

describe("summarizeWorkingState", () => {
  beforeEach(() => {
    generateText.mockReset()
  })

  it("returns the notes and reports usage", async () => {
    generateText.mockResolvedValue(ok("Neon project polished-poetry-96209335"))
    const onUsage = vi.fn()
    const summary = await summarizeWorkingState({
      workspaceId: "ws",
      previousSummary: null,
      messages: [text("assistant", "did a thing")],
      onUsage,
    })
    expect(summary).toContain("polished-poetry-96209335")
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "lor.compact", cachedInputTokens: 10 })
    )
  })

  it("merges prior notes with new activity", async () => {
    generateText.mockResolvedValue(ok("merged"))
    await summarizeWorkingState({
      workspaceId: "ws",
      previousSummary: "EARLIER NOTES",
      messages: [text("assistant", "new work")],
    })
    const prompt = String(generateText.mock.calls[0]?.[0]?.prompt)
    expect(prompt).toContain("EARLIER NOTES")
    expect(prompt).toContain("new work")
  })

  it("instructs the model to preserve identifiers verbatim", async () => {
    generateText.mockResolvedValue(ok("notes"))
    await summarizeWorkingState({
      workspaceId: "ws",
      previousSummary: null,
      messages: [text("assistant", "x")],
    })
    const instructions = String(generateText.mock.calls[0]?.[0]?.instructions)
    expect(instructions).toMatch(/verbatim/i)
  })

  it("returns null on failure and keeps prior notes when nothing is new", async () => {
    generateText.mockImplementation(() => {
      throw new Error("gateway down")
    })
    expect(
      await summarizeWorkingState({
        workspaceId: "ws",
        previousSummary: "kept",
        messages: [text("assistant", "x")],
      })
    ).toBeNull()
    generateText.mockReset()
    expect(
      await summarizeWorkingState({
        workspaceId: "ws",
        previousSummary: "kept",
        messages: [],
      })
    ).toBe("kept")
    expect(generateText).not.toHaveBeenCalled()
  })
})

describe("compact", () => {
  beforeEach(() => {
    generateText.mockReset()
  })

  const longConversation = (): ModelMessage[] => [
    text("user", "the original ask"),
    ...Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? call(`t${i}`) : result(`t${i - 1}`, { blob: bulky(20_000) })
    ),
  ]

  // The trigger check lives at the call site (prepareStep); compact() is only
  // reached once the caller has decided the context is too big.
  const base = {
    workspaceId: "ws",
    tailTargetTokens: 5_000,
  }

  it("keeps the original ask, inserts notes, and preserves a verbatim tail", async () => {
    generateText.mockResolvedValue(ok("found 2,553 policies"))
    const messages = longConversation()
    const out = await compact({
      ...base,
      messages,
      state: newCompactionState(),
    })
    expect(out[0]).toBe(messages[0])
    expect(String(out[1]?.content)).toContain("found 2,553 policies")
    // The tail is the real message objects, not rewritten copies.
    expect(out).toContain(messages[messages.length - 1])
    expect(out.length).toBeLessThan(messages.length)
  })

  it("produces a structurally valid message list", async () => {
    generateText.mockResolvedValue(ok("notes"))
    const messages = longConversation()
    const out = await compact({
      ...base,
      messages,
      state: newCompactionState(),
    })
    expect(isSafeSplit(out, out.length)).toBe(true)
  })

  it("restores authoritative plan state after the tail", async () => {
    generateText.mockResolvedValue(ok("notes"))
    const plan: AgentRunContextPlan = {
      title: "Export CSV",
      goal: "the goal",
      status: "running",
      steps: [{ text: "Query the audit log", status: "active" }],
      summary: null,
    }
    const out = await compact({
      ...base,
      messages: longConversation(),
      state: newCompactionState(),
      plan,
    })
    const last = String(out.at(-1)?.content)
    expect(last).toContain("Query the audit log")
    expect(last).toMatch(/authoritative/i)
  })

  // The SDK carries a prepareStep `messages` override forward, so the second
  // compaction sees the FIRST one's output (notes included) plus new steps —
  // not the original array. Feeding that back is the real-world sequence.
  it("compacts its own output again without stacking or freezing the notes", async () => {
    generateText.mockResolvedValue(ok("notes v1"))
    const state = newCompactionState()
    const first = await compact({
      ...base,
      messages: longConversation(),
      state,
    })
    expect(first.filter(isSummaryMessage)).toHaveLength(1)

    generateText.mockResolvedValue(ok("notes v2"))
    const carriedForward = [...first, ...longConversation().slice(1)]
    const second = await compact({
      ...base,
      messages: carriedForward,
      state,
    })
    // Exactly one notes message, and it is the refreshed one.
    expect(second.filter(isSummaryMessage)).toHaveLength(1)
    expect(String(second.find(isSummaryMessage)?.content)).toContain("notes v2")
    // It summarized the NEW activity, folding in the previous notes.
    const prompt = String(generateText.mock.calls.at(-1)?.[0]?.prompt)
    expect(prompt).toContain("notes v1")
    expect(isSafeSplit(second, second.length)).toBe(true)
  })

  it("replaces the previous plan-state block instead of stacking a second", async () => {
    const plan: AgentRunContextPlan = {
      title: "Repeat plan",
      goal: "compact twice",
      status: "running",
      steps: [],
      summary: null,
    }
    generateText.mockResolvedValue(ok("notes"))
    const state = newCompactionState()
    const first = await compact({
      ...base,
      messages: longConversation(),
      state,
      plan,
    })
    expect(first.filter(isStateMessage)).toHaveLength(1)
    // The first output's state block sits in the recent tail of the second
    // pass; without the filter it would survive alongside the fresh block.
    const carriedForward = [...first, ...longConversation().slice(1)]
    const second = await compact({
      ...base,
      messages: carriedForward,
      state,
      plan,
    })
    expect(second.filter(isStateMessage)).toHaveLength(1)
    expect(second.findIndex(isStateMessage)).toBe(second.length - 1)
  })

  it("does not re-summarize when nothing new has arrived since the notes", async () => {
    generateText.mockResolvedValue(ok("notes v1"))
    const state = newCompactionState()
    const first = await compact({
      ...base,
      messages: longConversation(),
      state,
    })
    const callsAfterFirst = generateText.mock.calls.length
    // Same array back in, no new activity appended.
    await compact({ ...base, messages: first, state })
    expect(generateText.mock.calls.length).toBe(callsAfterFirst)
  })

  it("falls back to a plain prune when summarization fails", async () => {
    generateText.mockImplementation(() => {
      throw new Error("gateway down")
    })
    const messages = longConversation()
    const state = newCompactionState()
    const out = await compact({
      ...base,
      messages,
      state,
    })
    expect(state.summaryFailures).toBe(1)
    expect(state.summary).toBeNull()
    // Still reduced (tool payloads pruned) and still valid.
    expect(isSafeSplit(out, out.length)).toBe(true)
    expect(out).not.toBe(messages)
  })

  it("stops retrying the summarizer after repeated failures", async () => {
    generateText.mockImplementation(() => {
      throw new Error("gateway down")
    })
    const state = newCompactionState()
    for (let i = 0; i < 5; i++) {
      await compact({
        ...base,
        messages: longConversation(),
        state,
      })
    }
    expect(state.summaryFailures).toBe(3)
    expect(generateText).toHaveBeenCalledTimes(3)
  })
})

describe("summaryMessage", () => {
  it("frames the notes as already-done work, not a new instruction", () => {
    const msg = summaryMessage("found 2,553 policies")
    expect(msg.role).toBe("user")
    expect(String(msg.content)).toMatch(/don't redo/i)
    expect(String(msg.content)).toMatch(/transcript is preserved/i)
  })
})
