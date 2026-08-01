import type { MerlinToolCall } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"
import { getInstallationToken, type InstallationRepo } from "./providers/github"
import { investigateCode } from "./sandbox/investigate"
import { toolExecutionKey } from "./tool-guard"
import type { OnUsage } from "./usage"

const MAX_LISTED = 30

// Validate Merlin's repo guess against connected repos before cloning.
function resolveRepo(
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

const codeContext = z.object({
  workspaceId: z.string(),
  installationId: z.string(),
  repos: z.custom<InstallationRepo[]>(),
  onUsage: z.custom<OnUsage>().optional(),
  onToolEvent: z.custom<(e: MerlinToolCall) => void>().optional(),
})

function repoHint(repos: InstallationRepo[]): string {
  return repos.length
    ? ` Connected repositories: ${repos
        .slice(0, MAX_LISTED)
        .map((r) => r.fullName)
        .join(", ")}.`
    : ""
}

export const codeTools = {
  investigate_code: tool({
    description: ({ context }) =>
      `Investigate the team's connected GitHub codebase to answer a code-level question — how something works, where it's implemented, or to trace a bug. Clones the repo into a sandbox and runs a coding agent to explore it (slow; use only when the answer genuinely needs the source, not for PRs/issues). Pass the repo as 'owner/repo' (must be one of the team's connected repositories) and a specific question.${repoHint(context.repos)}`,
    inputSchema: z.object({
      repo: z.string().describe("the repository as owner/repo"),
      question: z
        .string()
        .describe("the specific code question to investigate"),
    }),
    contextSchema: codeContext,
    execute: async ({ repo, question }, { toolCallId, context }) => {
      const resolved = resolveRepo(repo, context.repos)
      if ("error" in resolved) return { error: resolved.error }
      // Stable per-input identity (not toolCallId, which regenerates when a
      // recovered step retries): the same investigation in the same response
      // can never debit twice, across retries and run recovery alike.
      const billingKey = toolExecutionKey("investigate_code", {
        repo: resolved.repo,
        question,
      })

      const token = await getInstallationToken(context.installationId).catch(
        () => null
      )
      if (!token) return { error: "couldn't authenticate with GitHub" }

      let step = 0
      const result = await investigateCode({
        repoFullName: resolved.repo,
        cloneToken: token,
        question,
        onStep: (s) => {
          step += 1
          // A failing listener must not abort or fail the investigation.
          try {
            context.onToolEvent?.({
              toolCallId: `${toolCallId}:sub:${step}`,
              parentToolCallId: toolCallId,
              toolName: s.toolName,
              label: s.label,
            })
          } catch (err) {
            logger.error({ err }, "Merlin onToolEvent listener failed")
          }
        },
      }).catch(() => null)
      if (!result || "error" in result) {
        return { error: result?.error ?? "code investigation failed" }
      }

      if (result.usage) {
        try {
          context.onUsage?.({
            workspaceId: context.workspaceId,
            tool: "investigate_code",
            billingKey,
            model: result.usage.model,
            requestedModel: result.usage.requestedModel,
            inputTokens: result.usage.inputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.reasoningTokens,
            metadata: { repo: resolved.repo },
          })
        } catch (err) {
          logger.error({ err }, "Merlin onUsage listener failed")
        }
      }

      return { repo: resolved.repo, findings: result.findings }
    },
    strict: true,
  }),
}
