import { createHash, randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { env } from "@repo/env/server"
import { logger } from "../logger"
import {
  type BlaxelSandbox,
  execToCompletion,
  invalidatePersistentSandbox,
  runPi,
  withPersistentSandbox,
  writeText,
} from "./blaxel"
import {
  buildPiCommand,
  buildPiModelConfig,
  WORKBENCH_PI_TOOLS,
} from "./pi-config"
import type { PiCodeHandlers, PiInvestigationUsage } from "./pi-events"

export type CodeSessionUsage = PiInvestigationUsage

// A prepared change: committed inside the conversation's persistent sandbox,
// not yet on GitHub. Serializable on purpose — the future user-configured
// approval flow holds one of these between prepare and publish
// (authorizePublish in code-actions.ts is the seam).
export type ProposedChange = {
  repoFullName: string
  // PR base (the repo's default branch unless overridden in settings or by an
  // explicit request) and the commit the session started from.
  baseBranch: string
  baseSha: string
  branch: string
  commitSha: string
  title: string
  diffstat: string
}

export type PreparedCodeChange = {
  change: ProposedChange
  // The agent's closing summary — becomes the PR body.
  summary: string
  usage?: CodeSessionUsage
}

const CLONE_TIMEOUT_SEC = 180
const FETCH_TIMEOUT_SEC = 120
const GIT_TIMEOUT_SEC = 60
const PUSH_TIMEOUT_SEC = 180
const DIFFSTAT_MAX = 4000

const SESSION_DIR = "/workspace/.pi-sessions"
const BRIEF_FILE = "/code-brief.txt"
const COMMIT_MSG_FILE = "/commit-msg.txt"

// Everything interpolated into a shell command is validated first; tokens
// only ever travel as per-command process env (like the investigate clone).
const REPO_FULL_NAME =
  /^(?!\.{1,2}\/)(?![A-Za-z0-9._-]+\/\.{1,2}$)[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
// The only refs Lor may create or update — the push refspec is validated
// against this server-side, never model-controlled beyond the slug. "lor" is
// the product namespace GitHub contributors see (vendor-prefixed like
// dependabot/);
export const LOR_BRANCH = /^lor\/[a-z0-9][a-z0-9._-]{0,80}$/
const SAFE_REF = /^[A-Za-z0-9._/-]{1,120}$/

export function isSafeRef(ref: string): boolean {
  return SAFE_REF.test(ref) && !ref.includes("..") && !ref.startsWith("-")
}

export function lorBranchFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  return `lor/${slug || "change"}-${randomUUID().slice(0, 8)}`
}

// Pi session ids must be uuid-shaped (pi-config validates); derive one
// deterministically so a conversation resumes its own session per repo.
export function codeSessionId(
  sandboxKey: string,
  repoFullName: string
): string {
  const h = createHash("sha256")
    .update(`${sandboxKey}\n${repoFullName}`)
    .digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function codeSandboxName(sandboxKey: string): string {
  return `code-${sandboxKey}`
}

// One checkout per repo inside the conversation's sandbox.
export function repoWorkdir(repoFullName: string): string {
  return `/workspace/repos/${repoFullName.replace("/", "__")}`
}

function gitIdentity(): { name: string; email: string } {
  const slug = env.GITHUB_APP_SLUG
  const bot = slug && /^[a-z0-9-]+$/i.test(slug) ? `${slug}[bot]` : "lor[bot]"
  return { name: bot, email: `${bot}@users.noreply.github.com` }
}

function brief(workdir: string, instructions: string): string {
  return [
    `You are making a code change in the team's repository, checked out at ${workdir}`,
    "(a shallow clone — git history is limited). Explore it as needed (read, grep),",
    "then implement the requested change by editing files.",
    "",
    "Rules:",
    "- Do exactly what the request asks. Keep the change small and focused where",
    '  possible; don\'t refactor or "improve" unrelated code.',
    "- Never run git commands (commit, branch, push) and never touch .git —",
    "  version control happens outside this session.",
    "- Keep scratch work outside the repository (use /workspace/tmp); every modified file",
    "  in the checkout becomes part of the proposed change.",
    "- Install dependencies when needed to validate the change, but don't modify",
    "  lockfiles or manifests unless the requested change requires it.",
    "- When you finish, reply with a clear summary of what you changed and why —",
    "  it becomes the pull request description the team reviews.",
    "",
    `Change requested: ${instructions}`,
  ].join("\n")
}

type GitResult = {
  ok: boolean
  status: string
  exitCode: number
  stdout: string
  stderr: string
}

async function git(
  sandbox: BlaxelSandbox,
  command: string,
  opts?: { timeoutSec?: number; env?: Record<string, string> }
): Promise<GitResult> {
  const result = await execToCompletion(sandbox, {
    command,
    timeoutSec: opts?.timeoutSec ?? GIT_TIMEOUT_SEC,
    ...(opts?.env ? { env: opts.env } : {}),
  })
  return {
    ok: result.status === "completed" && result.exitCode === 0,
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function gitFailureDetail(result: GitResult): string {
  return (
    result.stderr.trim() || `${result.status}, exit code ${result.exitCode}`
  )
}

function isDiskFull(detail: string): boolean {
  return /ENOSPC|no space left on device/i.test(detail)
}

// Bring the checkout to a clean HEAD on `branch`: fresh shallow clone when the
// workdir doesn't exist yet, otherwise repair + fetch + hard reset. Published
// branches prefer the remote ref; unpublished retries can use their local ref.
export async function ensureCheckout(
  sandbox: BlaxelSandbox,
  opts: {
    repoFullName: string
    workdir: string
    baseBranch: string
    branch: string
    continueBranch: boolean
    cloneToken: string
  }
): Promise<{ baseSha: string } | { error: string }> {
  const { repoFullName, workdir, baseBranch, branch, continueBranch } = opts
  const tokenEnv = { GIT_TOKEN: opts.cloneToken }
  const tokenUrl = `https://x-access-token:$GIT_TOKEN@github.com/${repoFullName}.git`
  const scrub = (s: string) => s.split(opts.cloneToken).join("***")

  const existing = await git(
    sandbox,
    `git -C "${workdir}" rev-parse --is-inside-work-tree`
  )
  if (!existing.ok) {
    // A missing checkout emits a Git error. Empty stderr is how a wedged Blaxel
    // process runtime presents; don't misreport that as a clone failure.
    if (!existing.stderr.trim()) {
      const health = await git(sandbox, "true")
      if (!health.ok) {
        logger.warn(
          {
            repoFullName,
            status: health.status,
            exitCode: health.exitCode,
          },
          "Code session: sandbox process execution unavailable"
        )
        return {
          error:
            "sandbox process execution is unavailable; retry the code session so it can be recreated",
        }
      }
    }

    const parent = await git(sandbox, `mkdir -p "${dirname(workdir)}"`)
    if (!parent.ok) {
      return { error: "couldn't prepare the repository workspace" }
    }

    const clone = await git(
      sandbox,
      `git clone --depth 1 --single-branch --branch "${baseBranch}" "${tokenUrl}" "${workdir}" && git -C "${workdir}" remote set-url origin https://github.com/${repoFullName}.git`,
      { timeoutSec: CLONE_TIMEOUT_SEC, env: tokenEnv }
    )
    if (!clone.ok) {
      const detail = scrub(gitFailureDetail(clone).slice(0, 300))
      logger.warn(
        {
          repoFullName,
          status: clone.status,
          exitCode: clone.exitCode,
          detail,
        },
        "Code session: clone failed"
      )
      return { error: `clone failed: ${detail}` }
    }
  } else {
    // The agent had write access to the tree last session — repair the remote
    // and drop any leftover mess before trusting the checkout again.
    const repair = await git(
      sandbox,
      `git -C "${workdir}" remote set-url origin https://github.com/${repoFullName}.git && git -C "${workdir}" reset --hard && git -C "${workdir}" clean -fd`
    )
    if (!repair.ok) {
      return { error: "couldn't reset the existing checkout" }
    }
    const fetch = await git(
      sandbox,
      `git -C "${workdir}" fetch --depth 1 "${tokenUrl}" "+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}"`,
      { timeoutSec: FETCH_TIMEOUT_SEC, env: tokenEnv }
    )
    if (!fetch.ok) {
      const detail = scrub(gitFailureDetail(fetch).slice(0, 300))
      logger.warn(
        {
          repoFullName,
          status: fetch.status,
          exitCode: fetch.exitCode,
          detail,
        },
        "Code session: fetch failed"
      )
      return { error: `fetch failed: ${detail}` }
    }
  }

  let start = `refs/remotes/origin/${baseBranch}`
  if (continueBranch) {
    const fetch = await git(
      sandbox,
      `git -C "${workdir}" fetch --depth 1 "${tokenUrl}" "+refs/heads/${branch}:refs/remotes/origin/${branch}"`,
      { timeoutSec: FETCH_TIMEOUT_SEC, env: tokenEnv }
    )
    const remoteRef = `refs/remotes/origin/${branch}`
    const remote = await git(
      sandbox,
      `git -C "${workdir}" show-ref --verify --quiet "${remoteRef}"`
    )
    if (remote.ok) {
      start = remoteRef
    } else {
      const localRef = `refs/heads/${branch}`
      const local = await git(
        sandbox,
        `git -C "${workdir}" show-ref --verify --quiet "${localRef}"`
      )
      if (!local.ok) {
        const stderr = scrub(fetch.stderr.slice(0, 300))
        logger.warn(
          { repoFullName, branch, stderr },
          "Code session: continuation branch unavailable"
        )
        return {
          error:
            "couldn't find the branch to continue (it may have been merged, deleted, or lost with the sandbox — retry without a branch to start fresh)",
        }
      }
      start = localRef
    }
  }
  const checkout = await git(
    sandbox,
    `git -C "${workdir}" checkout -B "${branch}" "${start}"`
  )
  if (!checkout.ok) {
    return { error: `couldn't check out ${branch}` }
  }
  const head = await git(sandbox, `git -C "${workdir}" rev-parse HEAD`)
  const baseSha = head.stdout.trim()
  if (!(head.ok && COMMIT_SHA.test(baseSha))) {
    return { error: "couldn't resolve the checkout's base commit" }
  }
  return { baseSha }
}

// Run the write-enabled coding agent against the conversation's persistent
// sandbox, then stage and commit whatever it changed. Nothing leaves the
// sandbox here — publishCodeChange (below) is the only path to GitHub, so an
// approval flow can sit between the two.
export async function prepareCodeChange(
  opts: PiCodeHandlers & {
    sandboxKey: string
    repoFullName: string
    // The branch to branch off of and open the PR against.
    baseBranch: string
    cloneToken: string
    instructions: string
    title: string
    // An existing lor/* branch to continue (updates its PR); absent → new.
    branch?: string
    timeoutSec: number
    abortSignal?: AbortSignal
  }
): Promise<PreparedCodeChange | { error: string }> {
  const { repoFullName, baseBranch, instructions, title, abortSignal } = opts
  if (!REPO_FULL_NAME.test(repoFullName)) {
    return { error: `not a valid owner/repo name: ${repoFullName}` }
  }
  if (!isSafeRef(baseBranch)) {
    return { error: `unsupported base branch name: ${baseBranch}` }
  }
  if (opts.branch && !LOR_BRANCH.test(opts.branch)) {
    return {
      error: `branch must be a lor/* branch from a previous proposal, got: ${opts.branch}`,
    }
  }
  if (abortSignal?.aborted) return { error: "cancelled" }

  const branch = opts.branch ?? lorBranchFor(title)
  const continueBranch = Boolean(opts.branch)
  const workdir = repoWorkdir(repoFullName)
  const scrub = (s: string) => s.split(opts.cloneToken).join("***")

  try {
    return await withPersistentSandbox(
      codeSandboxName(opts.sandboxKey),
      env.LOR_CODE_SANDBOX_TTL,
      async (sandbox) => {
        const checkout = await ensureCheckout(sandbox, {
          repoFullName,
          workdir,
          baseBranch,
          branch,
          continueBranch,
          cloneToken: opts.cloneToken,
        })
        if ("error" in checkout) return checkout
        if (abortSignal?.aborted) return { error: "cancelled" }

        const setup = await git(
          sandbox,
          `mkdir -p ${SESSION_DIR} /workspace/repos /workspace/tmp /workspace/.cache /workspace/.local /root/.pi/agent`
        )
        if (!setup.ok) return { error: "code session setup failed" }
        await writeText(
          sandbox,
          "/root/.pi/agent/models.json",
          JSON.stringify(
            buildPiModelConfig({
              baseUrl: env.AI_GATEWAY_BASE_URL,
              model: env.LOR_MODEL,
            })
          )
        )
        await writeText(sandbox, BRIEF_FILE, brief(workdir, instructions))

        const run = await runPi(sandbox, {
          command: buildPiCommand(env.LOR_MODEL, {
            tools: WORKBENCH_PI_TOOLS,
            promptFile: BRIEF_FILE,
            print: true,
            session: {
              dir: SESSION_DIR,
              id: codeSessionId(opts.sandboxKey, repoFullName),
            },
          }),
          timeoutSec: opts.timeoutSec,
          workingDir: workdir,
          ...(abortSignal ? { abortSignal } : {}),
          ...(opts.onStep ? { onStep: opts.onStep } : {}),
          ...(opts.onAssistantText
            ? { onAssistantText: opts.onAssistantText }
            : {}),
          logLabel: "Code session",
        })
        logger.info(
          {
            repoFullName,
            exitCode: run.result.exitCode,
            status: run.result.status,
          },
          "Code session: agent finished"
        )
        if (abortSignal?.aborted) return { error: "cancelled" }

        // A half-finished session must not become a half-finished PR. The next
        // call starts from the branch's last commit, not uncommitted edits.
        if (run.result.status !== "completed" || run.result.exitCode !== 0) {
          const timedOut =
            run.result.status === "killed" || run.result.status === "lost"
          const detail = scrub(
            (run.result.stderr || run.result.stdout).slice(0, 300)
          )
          if (isDiskFull(detail)) {
            await invalidatePersistentSandbox(
              codeSandboxName(opts.sandboxKey),
              sandbox
            )
            return {
              error:
                "the coding sandbox ran out of disk space and will be recreated on retry. Retry propose_code_change with the complete instructions.",
            }
          }
          return {
            error: `the coding agent ${timedOut ? "timed out" : `failed: ${detail || "unknown error"}`}. Retry propose_code_change with the complete instructions${continueBranch ? "" : ` and branch "${branch}"`} to continue from the last committed branch state.`,
          }
        }
        if (run.error && !run.findings) {
          return { error: `the coding agent failed: ${run.error}` }
        }
        if (!run.usage) {
          return { error: "the coding agent returned no billable usage" }
        }

        const staged = await git(
          sandbox,
          `git -C "${workdir}" add -A && git -C "${workdir}" status --porcelain`
        )
        if (!staged.ok) return { error: "couldn't stage the change" }
        if (staged.stdout.trim().length > 0) {
          const identity = gitIdentity()
          await writeText(sandbox, COMMIT_MSG_FILE, title)
          const commit = await git(
            sandbox,
            `git -C "${workdir}" -c user.name="${identity.name}" -c user.email="${identity.email}" commit -F ${COMMIT_MSG_FILE} --no-verify`
          )
          if (!commit.ok) {
            return { error: `commit failed: ${commit.stderr.slice(0, 200)}` }
          }
        }

        const head = await git(sandbox, `git -C "${workdir}" rev-parse HEAD`)
        const commitSha = head.stdout.trim()
        if (!(head.ok && COMMIT_SHA.test(commitSha))) {
          return { error: "couldn't resolve the committed change" }
        }
        // Empty diff → no PR. The agent "finishing" without changing anything
        // is a real failure mode; filing an empty proposal burns trust.
        if (commitSha === checkout.baseSha) {
          return {
            error:
              "the coding agent made no changes to the repository — nothing to propose. If a change is genuinely needed, re-ask with more specific instructions.",
          }
        }
        const diffstat = await git(
          sandbox,
          `git -C "${workdir}" diff --stat ${checkout.baseSha} ${commitSha}`
        )

        return {
          change: {
            repoFullName,
            baseBranch,
            baseSha: checkout.baseSha,
            branch,
            commitSha,
            title,
            diffstat: diffstat.stdout.trim().slice(0, DIFFSTAT_MAX),
          },
          summary:
            run.findings || "(the agent didn't summarize what it changed)",
          usage: run.usage,
        }
      }
    )
  } catch (err) {
    logger.error({ err, repoFullName }, "Code session: prepare failed")
    return { error: "code session failed (sandbox error)" }
  }
}

// Push the exact prepared commit to its lor/* branch. Runs inside the
// sandbox (git state lives there) but under OUR command: the agent never sees
// the write token, never chooses the refspec, and hooks it may have written
// are disabled for the push.
export async function publishCodeChange(opts: {
  sandboxKey: string
  repoFullName: string
  branch: string
  commitSha: string
  pushToken: string
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { repoFullName, branch, commitSha } = opts
  if (!REPO_FULL_NAME.test(repoFullName)) {
    return { ok: false, reason: `not a valid owner/repo name: ${repoFullName}` }
  }
  if (!LOR_BRANCH.test(branch)) {
    return { ok: false, reason: `refusing to push non-lor branch ${branch}` }
  }
  if (!COMMIT_SHA.test(commitSha)) {
    return { ok: false, reason: "invalid commit sha" }
  }
  const workdir = repoWorkdir(repoFullName)
  const scrub = (s: string) => s.split(opts.pushToken).join("***")

  try {
    return await withPersistentSandbox(
      codeSandboxName(opts.sandboxKey),
      env.LOR_CODE_SANDBOX_TTL,
      async (sandbox) => {
        const checkout = await git(
          sandbox,
          `git -C "${workdir}" rev-parse --is-inside-work-tree`
        )
        if (!checkout.ok) {
          return {
            ok: false,
            reason:
              "the prepared change is unavailable; re-prepare it before publishing",
          }
        }

        // Never force-push, never push to origin (the agent may have
        // re-pointed it): explicit URL, explicit sha:ref refspec.
        const push = await git(
          sandbox,
          `git -C "${workdir}" -c core.hooksPath=/dev/null push --no-verify "https://x-access-token:$GIT_TOKEN@github.com/${repoFullName}.git" ${commitSha}:refs/heads/${branch}`,
          { timeoutSec: PUSH_TIMEOUT_SEC, env: { GIT_TOKEN: opts.pushToken } }
        )
        if (!push.ok) {
          const stderr = scrub(push.stderr.slice(0, 300))
          logger.warn(
            { repoFullName, branch, stderr },
            "Code session: push failed"
          )
          return { ok: false, reason: `push failed: ${stderr}` }
        }
        logger.info({ repoFullName, branch }, "Code session: branch pushed")
        return { ok: true }
      }
    )
  } catch (err) {
    logger.error({ err, repoFullName }, "Code session: publish failed")
    return { ok: false, reason: "publish failed (sandbox error)" }
  }
}
