import { beforeEach, describe, expect, it, vi } from "vitest"

// Each db.select() call resolves to the next queued result set; the builder
// methods in between are chainable no-ops. Queue order therefore mirrors the
// query order in buildContinuation: predecessor → consumed → delta → steps.
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
    MERLIN_USER_ID: "merlin-user",
    db: { select: () => chain() },
    schema: new Proxy(
      {},
      {
        get: () => new Proxy({}, { get: (_t, prop) => `col_${String(prop)}` }),
      }
    ),
  }
})

vi.mock("@repo/merlin", () => ({
  buildInitialUserMessage: vi.fn(async (context: { brainContext: string }) => ({
    role: "user",
    content: [{ type: "text", text: `initial:${context.brainContext}` }],
  })),
  userDisplayName: (u: { name: string }) => u.name,
}))

import { buildContinuation, formatDelta } from "./run-continuation"

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
  content: "go ahead",
  attachments: [],
  name: "Jacob",
  username: "jacob",
  displayUsername: "jacob",
}

const args = {
  scopeKey: "thread-1",
  channelId: "chan-1",
  merlinMessageId: "msg-placeholder",
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
    // predecessor → consumed(none) → delta(none)
    queue([predecessor], [], [])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("returns null when the chain checkpointed no steps", async () => {
    // predecessor → consumed → delta → (chain walk: none) → steps(none)
    queue([predecessor], [], [deltaRow], [])
    expect(await buildContinuation(args)).toBeNull()
  })

  it("assembles initial message + inherited steps + delta, in order", async () => {
    queue(
      [predecessor],
      [],
      [deltaRow],
      [step2("found 2553 rows", "run-1"), step2("ok", "run-1")]
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
    // Delta turns become the new run's snapshot conversation.
    expect(result?.conversation).toHaveLength(1)
    expect(result?.conversation[0]?.content).toBe("go ahead")
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
      },
    }
    const run1 = { ...predecessor, id: "run-1", continuedFromRunId: null }
    queue(
      [run2], // findPredecessor
      [], // consumed
      [deltaRow], // delta
      [run1], // chain walk: run-2 → run-1
      [step2("run1 work", "run-1"), step2("run2 work", "run-2")]
    )
    const result = await buildContinuation({ ...args, runId: "run-3" })
    const texts = result?.messages.map((m) => JSON.stringify(m.content))
    // Original snapshot, run-1's work, run-2's own delta, run-2's work, new delta.
    expect(texts?.[0]).toContain("initial:brain")
    expect(texts?.[1]).toContain("run1 work")
    expect(texts?.[2]).toContain("Jacob: go ahead")
    expect(texts?.[3]).toContain("run2 work")
    expect(texts?.at(-1)).toContain("Jacob: go ahead")
  })

  it("falls back to the fresh path instead of throwing when a query fails", async () => {
    // Predecessor and delta resolve; the chain walk blows up.
    queue([predecessor], [], [deltaRow], new Error("db down"))
    await expect(buildContinuation(args)).resolves.toBeNull()
  })
})
