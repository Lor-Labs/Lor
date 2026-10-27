import { describe, expect, it } from "vitest"
import { piToolLabel } from "./pi-events"

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
