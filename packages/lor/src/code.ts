import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { tool } from "ai"
import { z } from "zod"
import { isSafeBranch, REPO_FULL_NAME } from "./code-repo"
import { shallowCloneCommand } from "./code-session"
import { getInstallationToken, type InstallationRepo } from "./providers/github"

const MAX_LISTED = 30

// Validate Lor's repo guess against connected repos before cloning.
export function resolveRepo(
  requested: string,
  accessible: InstallationRepo[]
): { repo: string } | { error: string } {
  if (accessible.length === 0) return { repo: requested }
  const only = accessible[0]
  if (accessible.length === 1 && only) return { repo: only.fullName }

  const want = requested.trim().toLowerCase()
  const wantName = want.split("/").pop() ?? want
  const exact = accessible.find((r) => r.fullName.toLowerCase() === want)
  if (exact) return { repo: exact.fullName }
  const byName = accessible.filter(
    (r) => (r.fullName.split("/")[1] ?? "").toLowerCase() === wantName
  )
  const named = byName[0]
  if (byName.length === 1 && named) return { repo: named.fullName }

  const list = accessible
    .slice(0, MAX_LISTED)
    .map((r) => r.fullName)
    .join(", ")
  return {
    error: `"${requested}" isn't a connected repository. Connected repos: ${list}`,
  }
}

function repoHint(repos: InstallationRepo[]): string {
  return repos.length
    ? ` Connected repositories: ${repos
        .slice(0, MAX_LISTED)
        .map((r) => r.fullName)
        .join(", ")}.`
    : ""
}

// Exit codes of the update script for a clone that is kept as it is.
const KEPT_UNCOMMITTED = 3
const KEPT_LOCAL_COMMITS = 4

const cloneRepoContext = z.object({
  installationId: z.string(),
  repos: z.custom<InstallationRepo[]>(),
  // The conversation's work folder in the sandbox; clones go under repos/.
  workDir: z.string(),
})

// Copies a connected repository into the session sandbox so the main agent
// reads it with its own sandbox tools. Read only: egress allows fetch but not
// push, and nothing here commits. The read token lives only in the clone and
// fetch commands' env (pi-harness-runbook.md 1.4-2).
export const cloneRepoTool = {
  clone_repo: tool({
    description: ({ context }) =>
      `Clone one of the team's connected GitHub repositories into your sandbox to read its code: a shallow copy of one branch at its latest commit. Returns the folder; then search and read it with your sandbox tools. Calling it again for the same repository updates the copy to the branch's latest commit, unless you changed files in it. Pass the repo as 'owner/repo' and a branch, or null for the repository's default branch.${repoHint(context.repos)}`,
    inputSchema: z.object({
      repo: z.string().describe("the repository as owner/repo"),
      branch: z
        .string()
        .nullable()
        .describe("the branch to check out; null for the default branch"),
    }),
    contextSchema: cloneRepoContext,
    execute: async (
      { repo, branch },
      { context, experimental_sandbox: sandbox, abortSignal }
    ) => {
      if (!sandbox) return { error: "this run has no sandbox" }
      const resolved = resolveRepo(repo, context.repos)
      if ("error" in resolved) return { error: resolved.error }
      const fullName = resolved.repo
      const [owner, name] = fullName.split("/")
      if (!(REPO_FULL_NAME.test(fullName) && owner && name)) {
        return { error: `not a valid owner/repo: ${fullName}` }
      }
      // Null with no repo list: the clone takes GitHub's default branch.
      const target =
        branch ??
        context.repos.find((r) => r.fullName === fullName)?.defaultBranch ??
        null
      if (target !== null && !isSafeBranch(target)) {
        return { error: `not a valid branch name: ${target}` }
      }

      const token = await getInstallationToken(context.installationId, {
        repositories: [name],
        permissions: { contents: "read" },
        ...(abortSignal ? { request: { signal: abortSignal } } : {}),
      }).catch(() => null)
      if (!token) return { error: "couldn't authenticate with GitHub" }
      const scrub = (s: string) => s.split(token).join("***").trim()

      const dir = posix.join(context.workDir, "repos", owner, name)
      const q = shellQuote
      // Expanded by the shell from the command's env, so the token is never
      // part of a command string or the saved remote URL.
      const tokenUrl = `"https://x-access-token:$GIT_TOKEN@github.com/${fullName}.git"`
      const run = (command: string, withToken = false) =>
        sandbox.run({
          command,
          ...(withToken ? { env: { GIT_TOKEN: token } } : {}),
          ...(abortSignal ? { abortSignal } : {}),
        })

      const top = await run(`git -C ${q(dir)} rev-parse --show-toplevel`)
      let note: string | undefined
      if (top.exitCode !== 0 || top.stdout.trim() !== dir) {
        const clone = await run(
          shallowCloneCommand({ dir, fullName, branch: target }),
          true
        )
        if (clone.exitCode !== 0) {
          return { error: `clone failed: ${scrub(clone.stderr).slice(0, 300)}` }
        }
      } else {
        // An existing clone moves only when nothing in it is Lor's own work:
        // no uncommitted changes, and every branch head involved is one
        // fetched from GitHub. Never reset or clean it.
        const current = (
          await run(`git -C ${q(dir)} branch --show-current`)
        ).stdout.trim()
        const want = target ?? current
        if (!(want && isSafeBranch(want))) {
          return { error: "couldn't tell which branch to update" }
        }
        const remoteRef = `refs/remotes/origin/${want}`
        const update = await run(
          [
            `cd ${q(dir)} || exit 1`,
            `if [ -n "$(git status --porcelain)" ]; then exit ${KEPT_UNCOMMITTED}; fi`,
            `for ref in HEAD ${q(`refs/heads/${want}`)}; do if git rev-parse --verify --quiet "$ref" >/dev/null && [ -z "$(git for-each-ref --points-at "$ref" refs/remotes/origin)" ]; then exit ${KEPT_LOCAL_COMMITS}; fi; done`,
            `git fetch --quiet --depth 1 ${tokenUrl} ${q(`+refs/heads/${want}:${remoteRef}`)} || exit 1`,
            `git checkout --quiet -B ${q(want)} ${q(remoteRef)}`,
          ].join("\n"),
          true
        )
        if (update.exitCode === KEPT_UNCOMMITTED) {
          note =
            "Not updated: the clone has files you changed or added. It is as you left it."
        } else if (update.exitCode === KEPT_LOCAL_COMMITS) {
          note =
            "Not updated: the clone has commits made in the sandbox. It is as you left it."
        } else if (update.exitCode !== 0) {
          return {
            error: `update failed: ${scrub(update.stderr).slice(0, 300)}`,
          }
        }
      }

      const head = await run(
        `git -C ${q(dir)} branch --show-current && git -C ${q(dir)} rev-parse HEAD`
      )
      // A detached HEAD prints an empty branch line.
      const [checkedOut = "", commit = ""] = head.stdout
        .split("\n")
        .map((line) => line.trim())
      if (head.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
        return { error: "couldn't read the clone's commit" }
      }
      return {
        repo: fullName,
        path: dir,
        branch: checkedOut || null,
        commit,
        // A commit-pinned link base, so cited lines keep pointing at them.
        linkBase: `https://github.com/${fullName}/blob/${commit}/`,
        ...(note ? { note } : {}),
      }
    },
    strict: true,
  }),
}
