import { describe, expect, it } from "vitest"
import { matchTreeEntries } from "./connector-search"
import type { RepoTreeEntry } from "./providers/github"

const tree: RepoTreeEntry[] = [
  { path: "README.md", type: "blob" },
  { path: "src", type: "tree" },
  { path: "apps", type: "tree" },
  { path: "src/index.ts", type: "blob" },
  { path: "src/lib/index.ts", type: "blob" },
  { path: "apps/web/src/lib/deep/index.ts", type: "blob" },
  { path: "docs/indexing-notes.md", type: "blob" },
]

const paths = (hits: { id: string }[]) => hits.map((hit) => hit.id)

describe("matchTreeEntries", () => {
  it("lists the repo root with folders first when there is no query", () => {
    expect(paths(matchTreeEntries(tree, "o/r", "main", "", 10))).toEqual([
      "apps",
      "src",
      "README.md",
    ])
  })

  it("ranks exact basename matches above deeper and partial ones", () => {
    expect(
      paths(matchTreeEntries(tree, "o/r", "main", "index.ts", 10))
    ).toEqual([
      "src/index.ts",
      "src/lib/index.ts",
      "apps/web/src/lib/deep/index.ts",
    ])
  })

  it("ranks filename-stem matches above merely-prefixed names", () => {
    expect(paths(matchTreeEntries(tree, "o/r", "main", "index", 10))).toEqual([
      "src/index.ts",
      "src/lib/index.ts",
      "apps/web/src/lib/deep/index.ts",
      "docs/indexing-notes.md",
    ])
  })

  it("builds blob urls for files and tree urls for folders", () => {
    const [folder] = matchTreeEntries(tree, "o/r", "main", "src", 1)
    expect(folder?.url).toBe("https://github.com/o/r/tree/main/src")
    expect(folder?.subtitle).toBe("o/r · folder")

    const [file] = matchTreeEntries(tree, "o/r", "main", "README", 1)
    expect(file?.url).toBe("https://github.com/o/r/blob/main/README.md")
    expect(file?.subtitle).toBe("o/r")
  })

  it("encodes path segments without escaping the separators", () => {
    const [hit] = matchTreeEntries(
      [{ path: "docs/a b/c#d.md", type: "blob" }],
      "o/r",
      "main",
      "c#d",
      1
    )
    expect(hit?.url).toBe(
      "https://github.com/o/r/blob/main/docs/a%20b/c%23d.md"
    )
  })

  it("honours the limit", () => {
    expect(matchTreeEntries(tree, "o/r", "main", "index", 2)).toHaveLength(2)
  })
})
