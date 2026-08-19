import { describe, expect, it } from "vitest"
import {
  codeSandboxName,
  codeSessionId,
  isSafeRef,
  LOR_BRANCH,
  lorBranchFor,
  repoWorkdir,
} from "./code-session"

describe("lorBranchFor", () => {
  it("slugs the title into the lor/* namespace with a unique suffix", () => {
    const branch = lorBranchFor("Fix session refresh timezone bug")
    expect(branch).toMatch(LOR_BRANCH)
    expect(branch.startsWith("lor/fix-session-refresh-timezone-bug-")).toBe(
      true
    )
  })

  it("survives titles with no usable characters", () => {
    expect(lorBranchFor("!!! ???")).toMatch(LOR_BRANCH)
  })

  it("produces distinct branches for the same title", () => {
    expect(lorBranchFor("Fix bug")).not.toBe(lorBranchFor("Fix bug"))
  })
})

describe("LOR_BRANCH", () => {
  it("accepts only the lor/* namespace", () => {
    expect(LOR_BRANCH.test("lor/fix-thing-a1b2c3d4")).toBe(true)
    expect(LOR_BRANCH.test("main")).toBe(false)
    expect(LOR_BRANCH.test("lor/")).toBe(false)
    expect(LOR_BRANCH.test("lor/UPPER")).toBe(false)
    // Refspec injection attempts.
    expect(LOR_BRANCH.test("lor/x:refs/heads/main")).toBe(false)
    expect(LOR_BRANCH.test("lor/x main")).toBe(false)
  })
})

describe("codeSessionId", () => {
  it("is deterministic per scope + repo and uuid-shaped for pi", () => {
    const a = codeSessionId("scope-1", "acme/api")
    expect(a).toBe(codeSessionId("scope-1", "acme/api"))
    expect(a).not.toBe(codeSessionId("scope-2", "acme/api"))
    expect(a).not.toBe(codeSessionId("scope-1", "acme/web"))
    // Must satisfy pi-config's SESSION_ID: 36 chars of [a-f0-9-].
    expect(a).toMatch(/^[a-f0-9-]{36}$/)
  })
})

describe("isSafeRef", () => {
  it("accepts ordinary branch names and rejects hostile ones", () => {
    expect(isSafeRef("main")).toBe(true)
    expect(isSafeRef("release/v2.1")).toBe(true)
    expect(isSafeRef("--upload-pack=evil")).toBe(false)
    expect(isSafeRef("a..b")).toBe(false)
    expect(isSafeRef("branch name")).toBe(false)
  })
})

describe("workdir + sandbox naming", () => {
  it("derives shell-safe deterministic paths", () => {
    expect(repoWorkdir("acme/my-repo.js")).toBe("/repos/acme__my-repo.js")
    expect(codeSandboxName("abc-123")).toBe("code-abc-123")
  })
})
