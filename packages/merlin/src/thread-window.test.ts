import { describe, expect, it } from "vitest"
import { chooseThreadWindow } from "./thread-window"

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)

describe("chooseThreadWindow", () => {
  it("returns null for an anchor outside the thread", () => {
    expect(chooseThreadWindow(ids(5), "nope", {}, 10)).toBeNull()
  })

  it("returns the whole thread when it fits the window", () => {
    const w = chooseThreadWindow(ids(8), "m3", {}, 10)
    expect(w).toEqual({ start: 0, end: 8, omittedBefore: 0, omittedAfter: 0 })
  })

  it("centres the window on the anchor, not the thread start", () => {
    // 340 messages, anchor deep in the middle — the old oldest-100 shape
    // would never have shown it.
    const w = chooseThreadWindow(ids(340), "m200", {}, 100)
    expect(w?.start).toBe(150)
    expect(w?.end).toBe(250)
    // start - 1: the root is returned separately, so it is never "omitted".
    expect(w?.omittedBefore).toBe(149)
    expect(w?.omittedAfter).toBe(90)
  })

  it("slides to stay full at the edges instead of shrinking", () => {
    const newest = chooseThreadWindow(ids(340), "m335", {}, 100)
    expect(newest).toMatchObject({ start: 240, end: 340, omittedAfter: 0 })
    const oldest = chooseThreadWindow(ids(340), "m3", {}, 100)
    expect(oldest).toMatchObject({ start: 0, end: 100, omittedBefore: 0 })
  })

  it("pages older with before: strictly before the cursor, tail-aligned", () => {
    const w = chooseThreadWindow(ids(340), "m150", { before: "m150" }, 100)
    expect(w).toMatchObject({ start: 50, end: 150 })
    // the cursor itself is not re-included
    expect(w && ids(340).slice(w.start, w.end)).not.toContain("m150")
  })

  it("pages newer with after: strictly after the cursor", () => {
    const w = chooseThreadWindow(ids(340), "m150", { after: "m150" }, 100)
    expect(w).toMatchObject({ start: 151, end: 251 })
  })

  it("returns an empty window when paging before the thread start", () => {
    const w = chooseThreadWindow(ids(10), "m0", { before: "m0" }, 100)
    expect(w).toMatchObject({
      start: 0,
      end: 0,
      omittedBefore: 0,
      // The root is returned separately, leaving only the nine replies omitted.
      omittedAfter: 9,
    })
  })

  it("returns an empty window when paging past the newest message", () => {
    const w = chooseThreadWindow(ids(10), "m9", { after: "m9" }, 100)
    expect(w).toMatchObject({ start: 10, end: 10, omittedAfter: 0 })
  })
})
