import { beforeEach, describe, expect, it, vi } from "vitest"

// Each db.select() call resolves to the next queued result set; the builder
// methods in between are chainable no-ops. Queue order therefore mirrors the
// query order in buildContinuation: predecessor → replay chain/steps → consumed → delta.
// A queued Error makes that query reject, standing in for a DB failure.
const results: (unknown[] | Error)[] = []
function queue(...sets: (unknown[] | Error)[]) {
  results.length = 0
  results.push(...sets)
}

// Builder methods hang off a real promise, so the chain is awaitable at any
// point (as drizzle's is) without declaring a `then` property.
function chain(): unknown {
  const next = results.shift() ?? []
  const promise = (
    next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  ) as Promise<unknown> & Record<string, unknown>
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    promise[m] = () => promise
  }
  return promise
}

vi.mock("@repo/db", () => {
  // The chainable mock ignores predicates, so operators only need to exist.
  const op = () => ({})
  return {
    and: op,
    asc: op,
    desc: op,
    eq: op,
    gt: op,
    inArray: op,
    isNotNull: op,
    ne: op,
    notInArray: op,
    or: op,
    sql: op,
    LOR_USER_ID: "lor-user",
    db: { select: () => chain() },
    schema: new Proxy(
      {},
      {
        get: () => new Proxy({}, { get: (_t, prop) => `col_${String(prop)}` }),
      }
    ),
  }
})

vi.mock("@repo/lor", () => ({
  buildInitialUserMessage: vi.fn(async (context: { brainContext: string }) => ({
    role: "user",
    content: [{ type: "text", text: `initial:${context.brainContext}` }],
  })),
  estimateMessagesTokens: (messages: { content: unknown }[]) =>
    messages.reduce(
      (sum, m) => sum + Math.ceil(JSON.stringify(m.content).length / 4),
      0
    ),
  // Mirrors the real speaker-line shape: sanitized name, indented body lines.
  formatSpeakerLine: (name: string, body: string) =>
    `${name.replace(/[\r\n<>]+/g, " ").trim()}: ${body.replace(/\n/g, "\n  ")}`,
  // Same algorithm as compaction.ts's isSafeSplit: a split is valid only when
  // every tool call before it has its result before it too.
  isSafeSplit: (messages: { content: unknown }[], index: number) => {
    const called = new Set<string>()
    const resolved = new Set<string>()
    for (const m of messages.slice(0, index)) {
      const parts = Array.isArray(m.content) ? m.content : []
      for (const p of parts as { type?: string; toolCallId?: string }[]) {
        if (!p.toolCallId) continue
        if (p.type === "tool-call") called.add(p.toolCallId)
        if (p.type === "tool-result") resolved.add(p.toolCallId)
      }
    }
    for (const id of called) {
      if (!resolved.has(id)) return false
    }
    return true
  },
  userDisplayName: (u: { name: string }) => u.name,
}))

import {
  buildApprovalContinuation,
  buildContinuation,
  formatDelta,
  replayChain,
} from "./run-continuation"

const predecessor = {
  id: "run-1",
  context: { conversation: [], brainContext: "brain", rosterText: "" },
  continuedFromRunId: null,
  startedAt: new Date("2026-08-28T00:00:00Z"),
  createdAt: new Date("2026-08-28T00:00:00Z"),
  finishedAt: new Date("2026-08-28T00:10:00Z"),
}

const step2 = (text: string, runId: string) => ({
  runId,
  step: 1,
  messages: [{ role: "assistant", content: text }],
  inputTokens: 40_000,
})

const deltaRow = {
  id: "msg-go-ahead",
  content: "go ahead",
  attachments: [],
  name: "Jacob",
}

const args = {
  scopeKey: "thread-1",
  channelId: "chan-1",
  lorMessageId: "msg-placeholder",
  runId: "run-2",
}

describe("formatDelta", () => {
  it("returns null for an empty delta", () => {
    expect(formatDelta([])).toBeNull()
  })

  it("labels turns by author and tells the model to continue", () => {
    const text = formatDelta([{ authorName: "Jacob", content: "go ahead" }])
    expect(text).toContain("Jacob: go ahead")
    expect(text).toMatch(/pick up where you left off/i)
  })

  it("stays silent about short gaps but flags long ones for re-checking", () => {
    const turns = [{ authorName: "Jacob", content: "go ahead" }]
    expect(formatDelta(turns, 60_000)).not.toMatch(/since then/)
    expect(formatDelta(turns, 3 * 24 * 60 * 60 * 1000)).toMatch(
      /3 days since then.*re-check/s
    )
    expect(formatDelta(turns, 2 * 60 * 60 * 1000)).toMatch(/about 2 hours/)
  })

  it("says so out loud when messages had to be left out", () => {
    const turns = [{ authorName: "Jacob", content: "go ahead" }]
    expect(formatDelta(turns, 0, 0)).not.toMatch(/not shown/)
    const text = formatDelta(turns, 0, 12)
    expect(text).toContain("12 earlier messages in this thread are not shown")
    expect(text).toContain("read_thread")
  })

  it("renders attachments as [file: …] lines the file tools can consume", () => {
    const text = formatDelta([
      {
        authorName: "Jacob",
        content: "use this",
        files: [
          {
            url: "https://cdn.test/a.csv",
            filename: "a.csv",
            mediaType: "text/csv",
            size: 12,
          },
        ],
        images: [
          {
            url: "https://cdn.test/b.png",
            filename: "b.png",
            mediaType: "image/png",
            size: 34,
          },
        ],
      },
    ])
    expect(text).toContain(
      "[file: b.png — image/png, 34 bytes — https://cdn.test/b.png]"
    )
    expect(text).toContain(
      "[file: a.csv — text/csv, 12 bytes — https://cdn.test/a.csv]"
    )
  })
})

describe("buildContinuation", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("returns null when the scope has no eligible predecessor", async () => {
    queue([])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("returns null when nothing was said since the predecessor ran", async () => {
    // predecessor → chain head → steps → consumed(none) → delta(none)
    queue([predecessor], [predecessor], [step2("work", "run-1")], [], [])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("returns null when the chain checkpointed no steps", async () => {
    // predecessor → chain head → steps(none)
    queue([predecessor], [predecessor], [])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("assembles initial message + inherited steps + delta, in order", async () => {
    queue(
      [predecessor],
      [predecessor],
      [step2("found 2553 rows", "run-1"), step2("ok", "run-1")],
      [],
      [deltaRow]
    )
    const result = await buildContinuation(args)
    expect(result).not.toBeNull()
    expect(result?.predecessorRunId).toBe("run-1")
    expect(result?.messages).toHaveLength(4)
    expect(result?.messages[0]).toMatchObject({
      content: [{ text: "initial:brain" }],
    })
    expect(result?.messages[1]).toMatchObject({ content: "found 2553 rows" })
    expect(result?.messages[2]).toMatchObject({ content: "ok" })
    const last = result?.messages[3]
    expect(last?.role).toBe("user")
    expect(String(last?.content)).toContain("Jacob: go ahead")
    // Seeds compaction with the inherited transcript's real weight.
    expect(result?.lastInputTokens).toBe(40_000)
    // No compacted run in the chain: nothing to inherit.
    expect(result?.compaction).toBeNull()
    // Delta turns and their source IDs become the new run's snapshot.
    expect(result?.conversation).toHaveLength(1)
    expect(result?.conversation[0]?.content).toBe("go ahead")
    expect(result?.coveredMessageIds).toEqual(["msg-go-ahead"])
  })

  it("replays from the compaction baseline instead of the raw transcript", async () => {
    const baselineRun = {
      ...predecessor,
      compaction: {
        summary: "notes so far",
        summaryFailures: 2,
        baselineMessages: [
          { role: "user", content: "BASELINE snapshot + notes + tail" },
        ],
        atStep: 4,
      },
    }
    queue(
      [baselineRun], // findPredecessor
      [baselineRun], // replayChain head
      [
        {
          runId: "run-1",
          step: 4,
          messages: [{ role: "assistant", content: "pre-compaction step" }],
          inputTokens: 700_000,
        },
        {
          runId: "run-1",
          step: 5,
          messages: [{ role: "assistant", content: "post-compaction step" }],
          inputTokens: 90_000,
        },
      ],
      [], // consumed
      [deltaRow] // delta
    )
    const result = await buildContinuation(args)
    const texts = result?.messages.map((m) => JSON.stringify(m.content))
    // The baseline replaces the initial snapshot AND every step it covers
    // (step <= atStep); only steps checkpointed after it replay on top.
    expect(texts?.[0]).toContain("BASELINE snapshot + notes + tail")
    expect(texts?.join("\n")).not.toContain("pre-compaction step")
    expect(texts?.[1]).toContain("post-compaction step")
    expect(texts?.at(-1)).toContain("Jacob: go ahead")
    // Notes carry forward so the successor's compactor merges instead of
    // rebuilding; failure count resets — it belonged to the old run's
    // summarizer attempts.
    expect(result?.compaction).toEqual({
      summary: "notes so far",
      summaryFailures: 0,
    })
  })

  it("replays the whole chain, not just the immediate predecessor", async () => {
    // run-1 (original) → run-2 (continued it) → this run continues run-2.
    const run2 = {
      ...predecessor,
      id: "run-2",
      continuedFromRunId: "run-1",
      context: {
        conversation: [{ authorName: "Jacob", content: "go ahead" }],
        brainContext: "brain",
        rosterText: "",
        // Replayed verbatim rather than re-rendered, so elapsed-time wording
        // can't drift between the original run and a replay.
        continuationDelta: "STORED DELTA from run-2",
      },
    }
    const run1 = { ...predecessor, id: "run-1", continuedFromRunId: null }
    queue(
      [run2], // findPredecessor
      [run2], // replayChain head
      [run1], // chain walk: run-2 → run-1
      [step2("run1 work", "run-1"), step2("run2 work", "run-2")],
      [], // consumed
      [deltaRow] // delta
    )
    const result = await buildContinuation({ ...args, runId: "run-3" })
    const texts = result?.messages.map((m) => JSON.stringify(m.content))
    // Original snapshot, run-1's work, run-2's stored delta, run-2's work, new delta.
    expect(texts?.[0]).toContain("initial:brain")
    expect(texts?.[1]).toContain("run1 work")
    expect(texts?.[2]).toContain("STORED DELTA from run-2")
    expect(texts?.[3]).toContain("run2 work")
    expect(texts?.at(-1)).toContain("Jacob: go ahead")
  })

  it("starts mid-chain when the compacted run is not the newest hop", async () => {
    // run-1 compacted; run-2 continued it without compacting; run-3 continues
    // run-2. Replay must start at run-1's baseline, then run-2's delta+steps.
    const run1 = {
      ...predecessor,
      id: "run-1",
      continuedFromRunId: null,
      compaction: {
        summary: "run-1 notes",
        summaryFailures: 0,
        baselineMessages: [{ role: "user", content: "RUN1 BASELINE" }],
        atStep: 3,
      },
    }
    const run2 = {
      ...predecessor,
      id: "run-2",
      continuedFromRunId: "run-1",
      context: {
        conversation: [],
        brainContext: "brain",
        rosterText: "",
        continuationDelta: "DELTA into run-2",
      },
    }
    queue(
      [run2], // findPredecessor
      [run2], // replayChain head
      [run1], // chain walk: run-2 → run-1
      [
        {
          runId: "run-1",
          step: 4,
          messages: [{ role: "assistant", content: "run1 post-compaction" }],
          inputTokens: 90_000,
        },
        {
          runId: "run-2",
          step: 1,
          messages: [{ role: "assistant", content: "run2 work" }],
          inputTokens: 95_000,
        },
      ],
      [], // consumed
      [deltaRow] // delta
    )
    const result = await buildContinuation({ ...args, runId: "run-3" })
    const texts = result?.messages.map((m) => JSON.stringify(m.content))
    expect(texts?.[0]).toContain("RUN1 BASELINE")
    expect(texts?.[1]).toContain("run1 post-compaction")
    expect(texts?.[2]).toContain("DELTA into run-2")
    expect(texts?.[3]).toContain("run2 work")
    expect(result?.compaction).toEqual({
      summary: "run-1 notes",
      summaryFailures: 0,
    })
  })

  it("sizes the trigger by the inherited transcript, not the predecessor's last step", async () => {
    // A predecessor that compacted ends with SMALL steps precisely because the
    // bulk was projected out of its requests — but the transcript replayed
    // here still holds all of it. Trusting the small number would send the
    // whole thing uncompacted.
    const heavy = {
      runId: "run-1",
      step: 1,
      messages: [{ role: "assistant", content: "y".repeat(200_000) }],
      inputTokens: 900,
    }
    queue([predecessor], [predecessor], [heavy], [], [deltaRow])
    const result = await buildContinuation(args)
    expect(result?.lastInputTokens).toBeGreaterThan(40_000)
  })

  it("does not infer ambient coverage from transcript text before checkpoint", async () => {
    const ambientRow = {
      ...deltaRow,
      id: "msg-ambient",
      content: "status changed",
    }
    const injected = {
      runId: "run-1",
      step: 1,
      messages: [
        {
          role: "user",
          content:
            "The conversation continued while you were working. This is context, not a request — act on it only if it's addressed to you or changes your answer:\nJacob: status changed",
        },
        { role: "assistant", content: "updated work" },
      ],
      inputTokens: 40_000,
    }
    queue([predecessor], [predecessor], [injected], [], [deltaRow, ambientRow])

    const result = await buildContinuation(args)
    expect(result?.conversation.map((turn) => turn.content)).toEqual([
      "status changed",
      "go ahead",
    ])
    expect(result?.deltaText).toContain("status changed")
    expect(result?.conversation[0]).not.toHaveProperty("messageId")
  })

  it("excludes ambient IDs persisted by the predecessor checkpoint", async () => {
    const coveredRow = {
      ...deltaRow,
      id: "msg-covered",
      content: "already covered",
    }
    const coveredPredecessor = {
      ...predecessor,
      context: {
        ...predecessor.context,
        coveredMessageIds: ["msg-covered"],
      },
    }
    queue(
      [coveredPredecessor],
      [coveredPredecessor],
      [step2("work", "run-1")],
      [],
      [deltaRow, coveredRow]
    )

    const result = await buildContinuation(args)
    expect(result?.conversation.map((turn) => turn.content)).toEqual([
      "go ahead",
    ])
    expect(result?.deltaText).not.toContain("already covered")
  })

  it("carries the delta text so a recovered attempt can replay it verbatim", async () => {
    queue(
      [predecessor],
      [predecessor],
      [step2("work", "run-1")],
      [],
      [deltaRow]
    )
    const result = await buildContinuation(args)
    // The rendered text and the final message must be the same string: the
    // snapshot is what a crashed attempt replays.
    expect(result?.deltaText).toBe(String(result?.messages.at(-1)?.content))
    expect(result?.deltaText).toContain("Jacob: go ahead")
  })

  it("falls back to the fresh path instead of throwing when a query fails", async () => {
    queue([predecessor], new Error("db down"))
    await expect(buildContinuation(args)).resolves.toBeNull()
  })
})

describe("replayChain", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("rejects a cursor cycle instead of replaying a partial chain", async () => {
    const run2 = {
      ...predecessor,
      id: "run-2",
      continuedFromRunId: "run-1",
    }
    const run1 = {
      ...predecessor,
      id: "run-1",
      continuedFromRunId: "run-2",
    }
    queue([run2], [run1])
    await expect(replayChain("run-2")).resolves.toBeNull()
  })

  it("replays a complete acyclic chain at the hop cap", async () => {
    const runs = Array.from({ length: 20 }, (_, index) => ({
      ...predecessor,
      id: `run-${index}`,
      continuedFromRunId: index === 0 ? null : `run-${index - 1}`,
    }))
    const head = runs[19]
    expect(head).toBeDefined()
    queue(
      [head],
      ...runs
        .slice(0, 19)
        .reverse()
        .map((run) => [run]),
      [step2("oldest work", "run-0"), step2("newest work", "run-19")]
    )

    const replayed = await replayChain("run-19")
    expect(replayed?.messages.map((message) => message.content)).toEqual([
      [{ type: "text", text: "initial:brain" }],
      "oldest work",
      "newest work",
    ])
  })

  it("rejects a chain beyond the hop cap instead of replaying its suffix", async () => {
    const runs = Array.from({ length: 21 }, (_, index) => ({
      ...predecessor,
      id: `run-${index}`,
      continuedFromRunId: index === 0 ? null : `run-${index - 1}`,
    }))
    const head = runs[20]
    expect(head).toBeDefined()
    queue(
      [head],
      ...runs
        .slice(1, 20)
        .reverse()
        .map((run) => [run])
    )
    await expect(replayChain("run-20")).resolves.toBeNull()
  })

  it("accepts a compaction baseline before a cursor cycle", async () => {
    const run2 = {
      ...predecessor,
      id: "run-2",
      continuedFromRunId: "run-1",
    }
    const run1 = {
      ...predecessor,
      id: "run-1",
      continuedFromRunId: "run-2",
      compaction: {
        summary: "safe baseline",
        summaryFailures: 0,
        baselineMessages: [{ role: "user", content: "BASELINE" }],
        atStep: 0,
      },
    }
    queue([run2], [run1], [step2("continued work", "run-2")])

    const replayed = await replayChain("run-2")
    expect(replayed?.messages.map((message) => message.content)).toEqual([
      "BASELINE",
      "continued work",
    ])
  })

  it("moves a trimmed suffix back to the assistant tool-call boundary", async () => {
    const call = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "tool-1", toolName: "run_sql" },
      ],
    }
    const result = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "run_sql",
          output: "done",
        },
      ],
    }
    const tail = Array.from({ length: 398 }, (_, index) => ({
      role: "assistant",
      content: `tail-${index}`,
    }))
    queue(
      [predecessor],
      [
        {
          runId: "run-1",
          step: 1,
          messages: [call, result, ...tail],
          inputTokens: 40_000,
        },
      ]
    )

    const replayed = await replayChain("run-1")
    expect(replayed?.messages[0]).toMatchObject({ role: "user" })
    expect(replayed?.messages[1]).toEqual(call)
    expect(replayed?.messages[2]).toEqual(result)
  })

  it("does not trim a transcript at the inherited limit", async () => {
    const messages = Array.from({ length: 399 }, (_, index) => ({
      role: "assistant",
      content: `message-${index}`,
    }))
    queue(
      [predecessor],
      [
        {
          runId: "run-1",
          step: 1,
          messages,
          inputTokens: 40_000,
        },
      ]
    )

    const replayed = await replayChain("run-1")
    expect(replayed?.messages).toHaveLength(400)
    expect(replayed?.messages.at(-1)?.content).toBe("message-398")
  })
})

// Approval resume (LOR-81). Query order inside buildApprovalContinuation:
// approval row → parked run row → replayChain (chain head → step rows).
const parkedStep = {
  runId: "run-1",
  step: 1,
  messages: [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "create_linear_issue",
          input: { title: "Ship it" },
        },
        {
          type: "tool-approval-request",
          approvalId: "sdk-approval-1",
          toolCallId: "call-1",
        },
      ],
    },
  ],
  inputTokens: 1200,
}

const approvedRow = {
  runId: "run-1",
  status: "approved",
  toolCallId: "call-1",
}

const parkedRun = { state: "complete", stopReason: "awaiting_approval" }

describe("buildApprovalContinuation", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("ends the transcript with the approval response, never a delta", async () => {
    queue([approvedRow], [parkedRun], [predecessor], [parkedStep])
    const result = await buildApprovalContinuation({ approvalId: "apv-1" })
    expect(result?.predecessorRunId).toBe("run-1")
    expect(result?.deltaText).toBeNull()
    expect(result?.approvalResume).toEqual({
      approvalId: "sdk-approval-1",
      approved: true,
    })
    // The SDK only reads messages.at(-1) for approval responses.
    expect(result?.messages.at(-1)).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "sdk-approval-1",
          approved: true,
        },
      ],
    })
  })

  it("carries a rejection through as a denial", async () => {
    queue(
      [{ ...approvedRow, status: "rejected" }],
      [parkedRun],
      [predecessor],
      [parkedStep]
    )
    const result = await buildApprovalContinuation({ approvalId: "apv-1" })
    expect(result?.approvalResume?.approved).toBe(false)
  })

  it("refuses a still-pending approval", async () => {
    queue([{ ...approvedRow, status: "pending" }])
    expect(await buildApprovalContinuation({ approvalId: "apv-1" })).toBeNull()
  })

  it("refuses a discretionary approval with no parked tool call", async () => {
    queue([{ ...approvedRow, toolCallId: null }])
    expect(await buildApprovalContinuation({ approvalId: "apv-1" })).toBeNull()
  })

  it("refuses a predecessor that never parked", async () => {
    queue([approvedRow], [{ state: "complete", stopReason: "completed" }])
    expect(await buildApprovalContinuation({ approvalId: "apv-1" })).toBeNull()
  })

  it("refuses when the approval request was trimmed out of the replay", async () => {
    queue(
      [approvedRow],
      [parkedRun],
      [predecessor],
      [step2("no approval request here", "run-1")]
    )
    expect(await buildApprovalContinuation({ approvalId: "apv-1" })).toBeNull()
  })

  it("falls back to a fresh context instead of throwing when a query fails", async () => {
    queue(new Error("db down"))
    expect(await buildApprovalContinuation({ approvalId: "apv-1" })).toBeNull()
  })
})

describe("parked predecessors", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("never replays a parked run through the delta path", async () => {
    // Queue everything a successful delta continuation would consume, so this
    // only passes because of the awaiting_approval guard — not because the
    // mock ran dry (see control case below).
    const parked = { ...predecessor, stopReason: "awaiting_approval" }
    queue([parked], [parked], [step2("parked work", "run-1")], [], [deltaRow])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("control: the same result sets with a settled predecessor continue", async () => {
    const settled = { ...predecessor, stopReason: "completed" }
    queue([settled], [settled], [step2("work", "run-1")], [], [deltaRow])
    expect(await buildContinuation(args)).not.toBeNull()
  })

  it("replays an earlier hop's approval response in place of a delta", async () => {
    const head = { ...predecessor, id: "run-0" }
    const resumeHop = {
      id: "run-1",
      context: {
        conversation: [],
        brainContext: "brain",
        rosterText: "",
        approvalResume: {
          approvalId: "sdk-approval-1",
          approved: true,
          toolName: "create_linear_issue",
          target: "tool:create_linear_issue",
        },
      },
      continuedFromRunId: "run-0",
      compaction: null,
    }
    queue(
      [resumeHop],
      [head],
      [step2("parked work", "run-0"), step2("carried on", "run-1")]
    )
    const replayed = await replayChain("run-1")
    expect(replayed?.messages[2]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "sdk-approval-1",
          approved: true,
        },
      ],
    })
  })
})
