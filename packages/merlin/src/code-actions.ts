import type { MerlinToolCallUpdate } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { tool } from "ai"
import { z } from "zod"
import { resolveRepo } from "./code"
import { logger } from "./logger"
import {
  getInstallationToken,
  type InstallationRepo,
  openPullRequest,
} from "./providers/github"
import {
  LOR_BRANCH,
  type ProposedChange,
  prepareCodeChange,
  publishCodeChange,
} from "./sandbox/code-session"
import { subagentToolEvents } from "./sandbox/sub-events"
import { toolExecutionKey } from "./tool-guard"
import type { OnUsage } from "./usage"

const MAX_LISTED = 30
// A session must have this much wall clock left to be worth starting; the
// margin leaves room to commit, push, and open the PR after the agent stops.
const MIN_REMAINING_MS = 5 * 60_000
const FINISH_MARGIN_MS = 3 * 60_000

const codeActionsContext = z.object({
  workspaceId: z.string(),
  installationId: z.string(),
  repos: z.custom<InstallationRepo[]>(),
  // The conversation scope (thread root or channel) — keys the persistent
  // sandbox so follow-ups resume a warm checkout and Pi session.
  sandboxKey: z.string(),
  deadlineAt: z.custom<Date>().optional(),
  onUsage: z.custom<OnUsage>().optional(),
  onToolEvent: z.custom<(e: MerlinToolCallUpdate) => void>().optional(),
})

// The future user-configured approval flow plugs in HERE: "hold" would
// persist the ProposedChange (approval payload) and end the run pending a
// human decision instead of publishing. v1 always publishes — the draft PR
// itself is the review gate (never auto-merged).
function authorizePublish(_change: ProposedChange): "publish" | "hold" {
  return "publish"
}

// Parallel calls in one step must not share the scope's sandbox (or its Pi
// session) concurrently — serialize per sandbox key. Cross-process overlap
// can't happen: a scope has at most one active run.
const scopeSessions = new Map<string, Promise<unknown>>()

function serializeScopeSession<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = scopeSessions.get(key) ?? Promise.resolve()
  const run = prev.then(fn)
  const settled = run.then(
    () => {},
    () => {}
  )
  scopeSessions.set(key, settled)
  void settled.then(() => {
    if (scopeSessions.get(key) === settled) scopeSessions.delete(key)
  })
  return run
}

function repoHint(repos: InstallationRepo[]): string {
  return repos.length
    ? ` Connected repositories: ${repos
        .slice(0, MAX_LISTED)
        .map((r) => r.fullName)
        .join(", ")}.`
    : ""
}

export const codeActionTools = {
  propose_code_change: tool({
    description: ({ context }) =>
      `Make a code change in one of the team's connected GitHub repositories and open a DRAFT pull request for the team to review — it is never merged automatically. Runs a coding agent in a sandbox on a fresh checkout; slow and consequential, so use it only on a clear request to change code (fix, implement, adjust), never for questions about code (use investigate_code). Pass complete, self-contained instructions — the agent can't ask follow-ups — and keep each proposal small and focused; split unrelated changes into separate calls. To iterate on a proposal from earlier in this conversation (review feedback, follow-up fixes), pass its branch to update the same pull request.${repoHint(context.repos)}`,
    inputSchema: z.object({
      repo: z.string().describe("the repository as owner/repo"),
      title: z
        .string()
        .min(1)
        .max(80)
        .describe(
          'imperative pull-request title, e.g. "Fix session refresh timezone bug"'
        ),
      instructions: z
        .string()
        .min(1)
        .describe(
          "complete instructions for the change: what to do, where, and any constraints"
        ),
      branch: z
        .string()
        .nullable()
        .describe(
          "a lor/* branch returned by a previous propose_code_change in this conversation, to continue that proposal; null for a new change"
        ),
    }),
    contextSchema: codeActionsContext,
    execute: async (
      { repo, title, instructions, branch },
      { toolCallId, context, abortSignal }
    ) => {
      const resolved = resolveRepo(repo, context.repos)
      if ("error" in resolved) return { error: resolved.error }
      const repoRow = context.repos.find((r) => r.fullName === resolved.repo)
      const defaultBranch = repoRow?.defaultBranch
      if (!defaultBranch) {
        return { error: "couldn't determine the repository's default branch" }
      }
      if (branch && !LOR_BRANCH.test(branch)) {
        return {
          error:
            "branch must be a lor/* branch from a previous proposal in this conversation (or null for a new change)",
        }
      }

      const remainingMs = context.deadlineAt
        ? context.deadlineAt.getTime() - Date.now()
        : null
      if (remainingMs !== null && remainingMs < MIN_REMAINING_MS) {
        return {
          error:
            "not enough time left in this run for a code session; answer with what you have and suggest re-asking",
        }
      }
      const timeoutSec = Math.min(
        env.MERLIN_WORKBENCH_TIMEOUT_SEC,
        remainingMs !== null
          ? Math.floor((remainingMs - FINISH_MARGIN_MS) / 1000)
          : env.MERLIN_WORKBENCH_TIMEOUT_SEC
      )

      // Stable per-input identity: recovery replays the stored result instead
      // of re-running the session, re-pushing, or re-filing the PR.
      const billingKey = toolExecutionKey("propose_code_change", {
        repo: resolved.repo,
        title,
        instructions,
        branch,
      })

      const [owner, repoName] = resolved.repo.split("/")
      if (!(owner && repoName)) {
        return { error: `not a valid owner/repo: ${resolved.repo}` }
      }
      // Read-scoped mint for clone/fetch; the write token is minted only
      // after the change is prepared and authorized.
      const cloneToken = await getInstallationToken(context.installationId, {
        repositories: [repoName],
        permissions: { contents: "read" },
      }).catch(() => null)
      if (!cloneToken) return { error: "couldn't authenticate with GitHub" }

      const prepared = await serializeScopeSession(context.sandboxKey, () =>
        prepareCodeChange({
          sandboxKey: context.sandboxKey,
          repoFullName: resolved.repo,
          defaultBranch,
          cloneToken,
          instructions,
          title,
          ...(branch ? { branch } : {}),
          timeoutSec,
          ...(abortSignal ? { abortSignal } : {}),
          ...subagentToolEvents({
            parentToolCallId: toolCallId,
            onToolEvent: context.onToolEvent,
          }),
        })
      ).catch((err) => {
        logger.error({ err }, "Code session: prepare threw")
        return null
      })
      if (!prepared || "error" in prepared) {
        return { error: prepared?.error ?? "code session failed" }
      }

      if (prepared.usage) {
        try {
          context.onUsage?.({
            workspaceId: context.workspaceId,
            tool: "propose_code_change",
            billingKey,
            model: prepared.usage.model,
            requestedModel: prepared.usage.requestedModel,
            inputTokens: prepared.usage.inputTokens,
            cachedInputTokens: prepared.usage.cachedInputTokens,
            outputTokens: prepared.usage.outputTokens,
            reasoningTokens: prepared.usage.reasoningTokens,
            metadata: { repo: resolved.repo },
          })
        } catch (err) {
          logger.error({ err }, "Merlin onUsage listener failed")
        }
      }

      const { change } = prepared
      if (authorizePublish(change) !== "publish") {
        // Unreachable in v1; the approval flow will persist the change and
        // park the run here.
        return { error: "this change requires approval before publishing" }
      }
      if (abortSignal?.aborted) return { error: "cancelled" }

      const pushToken = await getInstallationToken(context.installationId, {
        repositories: [repoName],
        permissions: { contents: "write" },
      }).catch(() => null)
      if (!pushToken) {
        return {
          error:
            "couldn't get write access to GitHub — the App installation may need to approve updated (write) permissions. The prepared change is preserved; retry once permissions are granted.",
        }
      }
      const pushed = await publishCodeChange({
        sandboxKey: context.sandboxKey,
        repoFullName: change.repoFullName,
        branch: change.branch,
        commitSha: change.commitSha,
        pushToken,
      })
      if (!pushed.ok) return { error: pushed.reason }

      const body = `${prepared.summary}\n\n---\n*This draft pull request was proposed by Merlin from a team conversation. Review carefully before merging.*`
      const pr = await openPullRequest(context.installationId, {
        repoFullName: change.repoFullName,
        head: change.branch,
        base: change.baseBranch,
        title: change.title,
        body,
      })
      if (!pr.ok) {
        return {
          error: `the branch ${change.branch} was pushed, but ${pr.reason}`,
        }
      }

      return {
        repo: change.repoFullName,
        pullRequest: {
          url: pr.pr.url,
          number: pr.pr.number,
          draft: pr.pr.draft,
          updatedExisting: !pr.pr.created,
        },
        branch: change.branch,
        diffstat: change.diffstat,
        summary: prepared.summary,
      }
    },
    strict: true,
  }),
}
