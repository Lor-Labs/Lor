import type { MerlinToolCall } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import { getInstallationToken, type InstallationRepo } from "./providers/github"
import { investigateCode } from "./sandbox/investigate"
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

export function buildCodeTools(
  workspaceId: string,
  {
    installationId,
    onUsage,
    onToolEvent,
    repos = [],
    disabled = false,
  }: {
    installationId: string
    onUsage?: OnUsage
    onToolEvent?: (e: MerlinToolCall) => void
    repos?: InstallationRepo[]
    // Keep the tool defined (Anthropic requires prior tool names to stay
    // declared) but cheaply no-op it — e.g. during background write-back, which
    // shouldn't kick off fresh sandbox runs.
    disabled?: boolean
  }
) {
  const repoHint = repos.length
    ? ` Connected repositories: ${repos
        .slice(0, MAX_LISTED)
        .map((r) => r.fullName)
        .join(", ")}.`
    : ""
  return {
    investigate_code: tool({
      description: `Investigate the team's connected GitHub codebase to answer a code-level question — how something works, where it's implemented, or to trace a bug. Clones the repo into a sandbox and runs a coding agent to explore it (slow; use only when the answer genuinely needs the source, not for PRs/issues). Pass the repo as 'owner/repo' (must be one of the team's connected repositories) and a specific question.${repoHint}`,
      inputSchema: z.object({
        repo: z.string().describe("the repository as owner/repo"),
        question: z
          .string()
          .describe("the specific code question to investigate"),
      }),
      execute: async ({ repo, question }, { toolCallId }) => {
        if (disabled) {
          return { error: "code investigation is disabled during write-back" }
        }
        const resolved = resolveRepo(repo, repos)
        if ("error" in resolved) return { error: resolved.error }

        const token = await getInstallationToken(installationId).catch(
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
            onToolEvent?.({
              toolCallId: `${toolCallId}:sub:${step}`,
              parentToolCallId: toolCallId,
              toolName: s.toolName,
              label: s.label,
            })
          },
        }).catch(() => null)
        if (!result || "error" in result) {
          return { error: result?.error ?? "code investigation failed" }
        }

        if (result.usage) {
          onUsage?.({
            workspaceId,
            tool: "investigate_code",
            model: result.usage.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            costUsd: result.usage.costUsd,
            metadata: { repo: resolved.repo },
          })
        }

        return { repo: resolved.repo, findings: result.findings }
      },
      strict: true,
    }),
  }
}
