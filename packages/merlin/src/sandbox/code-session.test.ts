import { env } from "@repo/env/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type BlaxelSandbox,
  execToCompletion,
  withPersistentSandbox,
} from "./blaxel"
import {
  codeSandboxName,
  codeSessionId,
  ensureCheckout,
  isSafeRef,
  LOR_BRANCH,
  lorBranchFor,
  publishCodeChange,
  repoWorkdir,
} from "./code-session"

vi.mock("./blaxel", () => ({
  execToCompletion: vi.fn(),
  invalidatePersistentSandbox: vi.fn(),
  runPi: vi.fn(),
  withPersistentSandbox: vi.fn(),
  writeText: vi.fn(),
}))

const validPublish = {
  sandboxKey: "scope-1",
  repoFullName: "acme/api",
  branch: "lor/fix-thing-a1b2c3d4",
  commitSha: "a".repeat(40),
  pushToken: "token",
}

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
    expect(repoWorkdir("acme/my-repo.js")).toBe(
      "/workspace/repos/acme__my-repo.js"
    )
    expect(codeSandboxName("abc-123")).toBe("code-abc-123")
  })
})

describe("ensureCheckout", () => {
  const completed = {
    status: "completed" as const,
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
  // Deliberately not "main": the repo base-branch override is only honoured if
  // every git step reads the configured branch instead of the repo default.
  const BASE_BRANCH = "release/2026"

  beforeEach(() => {
    vi.mocked(execToCompletion).mockReset()
  })

  it("creates the repository parent and clones the configured base branch in a fresh sandbox", async () => {
    const sandbox = {} as BlaxelSandbox
    const exec = vi.mocked(execToCompletion)
    exec
      .mockResolvedValueOnce({
        ...completed,
        status: "failed",
        exitCode: 128,
        stderr: "fatal: cannot change to repository directory",
      })
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce({ ...completed, stdout: `${"a".repeat(40)}\n` })

    await expect(
      ensureCheckout(sandbox, {
        repoFullName: "acme/api",
        workdir: repoWorkdir("acme/api"),
        baseBranch: BASE_BRANCH,
        branch: "lor/fix-thing-a1b2c3d4",
        continueBranch: false,
        cloneToken: "token",
      })
    ).resolves.toEqual({ baseSha: "a".repeat(40) })

    expect(exec).toHaveBeenNthCalledWith(
      2,
      sandbox,
      expect.objectContaining({ command: 'mkdir -p "/workspace/repos"' })
    )
    expect(exec).toHaveBeenNthCalledWith(
      3,
      sandbox,
      expect.objectContaining({
        command: expect.stringContaining(
          `git clone --depth 1 --single-branch --branch "${BASE_BRANCH}"`
        ),
      })
    )
    expect(exec).toHaveBeenNthCalledWith(
      4,
      sandbox,
      expect.objectContaining({
        command: expect.stringContaining(
          `checkout -B "lor/fix-thing-a1b2c3d4" "refs/remotes/origin/${BASE_BRANCH}"`
        ),
      })
    )
  })

  it("fetches and branches from the configured base branch in an existing checkout", async () => {
    const sandbox = {} as BlaxelSandbox
    const exec = vi.mocked(execToCompletion)
    exec
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce({ ...completed, stdout: `${"b".repeat(40)}\n` })

    await expect(
      ensureCheckout(sandbox, {
        repoFullName: "acme/api",
        workdir: repoWorkdir("acme/api"),
        baseBranch: BASE_BRANCH,
        branch: "lor/fix-thing-a1b2c3d4",
        continueBranch: false,
        cloneToken: "token",
      })
    ).resolves.toEqual({ baseSha: "b".repeat(40) })

    expect(exec).toHaveBeenNthCalledWith(
      3,
      sandbox,
      expect.objectContaining({
        command: expect.stringContaining(
          `+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}`
        ),
      })
    )
    expect(exec).toHaveBeenNthCalledWith(
      4,
      sandbox,
      expect.objectContaining({
        command: expect.stringContaining(
          `checkout -B "lor/fix-thing-a1b2c3d4" "refs/remotes/origin/${BASE_BRANCH}"`
        ),
      })
    )
  })
})

describe("publishCodeChange guards", () => {
  beforeEach(() => {
    vi.mocked(withPersistentSandbox).mockClear()
  })

  it("uses the code sandbox TTL for a valid publish", async () => {
    vi.mocked(withPersistentSandbox).mockResolvedValue({ ok: true })

    await publishCodeChange(validPublish)

    expect(withPersistentSandbox).toHaveBeenCalledWith(
      "code-scope-1",
      env.MERLIN_CODE_SANDBOX_TTL,
      expect.any(Function)
    )
  })

  it("rejects the main branch before opening a sandbox", async () => {
    await expect(
      publishCodeChange({ ...validPublish, branch: "main" })
    ).resolves.toEqual({
      ok: false,
      reason: "refusing to push non-lor branch main",
    })
    expect(withPersistentSandbox).not.toHaveBeenCalled()
  })

  it("rejects an unsafe repository name before opening a sandbox", async () => {
    await expect(
      publishCodeChange({ ...validPublish, repoFullName: "../evil" })
    ).resolves.toEqual({
      ok: false,
      reason: "not a valid owner/repo name: ../evil",
    })
    expect(withPersistentSandbox).not.toHaveBeenCalled()
  })

  it("rejects a short commit SHA before opening a sandbox", async () => {
    await expect(
      publishCodeChange({ ...validPublish, commitSha: "abc123" })
    ).resolves.toEqual({ ok: false, reason: "invalid commit sha" })
    expect(withPersistentSandbox).not.toHaveBeenCalled()
  })
})
