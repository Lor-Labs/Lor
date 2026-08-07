import { describe, expect, it } from "vitest"
import { encodeTree, parseCachedTree } from "./github"
import type { RepoTree } from "./providers/github"

const tree: RepoTree = {
  ref: "main",
  entries: [
    { path: "README.md", type: "blob" },
    { path: "src", type: "tree" },
  ],
  truncated: false,
}

describe("repo tree cache", () => {
  it("round-trips a compressed tree", () => {
    expect(parseCachedTree(encodeTree(tree))).toEqual(tree)
  })

  it("compresses well below the raw json", () => {
    const big: RepoTree = {
      ref: "main",
      truncated: false,
      entries: Array.from({ length: 2000 }, (_, i) => ({
        path: `apps/web/src/components/module-${i}/index.tsx`,
        type: "blob" as const,
      })),
    }
    expect(encodeTree(big).length).toBeLessThan(JSON.stringify(big).length / 4)
  })

  it("still reads values written before compression landed", () => {
    expect(parseCachedTree(JSON.stringify(tree))).toEqual(tree)
  })

  it("drops malformed entries instead of returning them", () => {
    const raw = JSON.stringify({
      ref: "main",
      truncated: false,
      entries: [
        { path: "ok.ts", type: "blob" },
        { path: 42, type: "blob" },
        { path: "weird.ts", type: "commit" },
        null,
      ],
    })
    expect(parseCachedTree(raw)?.entries).toEqual([
      { path: "ok.ts", type: "blob" },
    ])
  })

  it("rejects a payload whose container is wrong", () => {
    expect(parseCachedTree("not json")).toBeNull()
    expect(parseCachedTree(JSON.stringify({ ref: "main" }))).toBeNull()
    expect(parseCachedTree(JSON.stringify({ entries: [] }))).toBeNull()
  })
})
