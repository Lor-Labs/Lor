import { describe, expect, it, vi } from "vitest"

// Each db.select() call resolves to the next queued result set; the builder
// methods in between are chainable no-ops. A queued Error makes that query
// reject, standing in for a DB failure.
const results: (unknown[] | Error)[] = []

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
  // Mirrors the real speaker-line shape: sanitized name, indented body lines.
  formatSpeakerLine: (name: string, body: string) =>
    `${name.replace(/[\r\n<>]+/g, " ").trim()}: ${body.replace(/\n/g, "\n  ")}`,
  userDisplayName: (u: { name: string }) => u.name,
}))

import { formatDelta } from "./run-continuation"

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
