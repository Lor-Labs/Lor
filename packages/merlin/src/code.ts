import { and, db, eq, schema } from "@repo/db"
import type { MerlinToolCall } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import {
  getInstallationToken,
  type InstallationRepo,
  listInstallationRepos,
} from "./providers/github"
import { investigateCode } from "./sandbox/investigate"
import type { OnUsage } from "./usage"

// Cap repo names listed in the tool description / errors so a big "All repos"
// org doesn't blow up the prompt.
const MAX_LISTED = 30

// The active GitHub installation id for a workspace (one active connection per
// workspace), or null when GitHub isn't connected.
async function activeGithubInstallation(
  workspaceId: string
): Promise<string | null> {
  const connection = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "github"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return connection?.externalId ?? null
}

// The repos Merlin can investigate for a workspace — fed into its context so it
// targets a real repo instead of guessing owner/repo. Empty when GitHub isn't
// connected (or the App can't enumerate).
export async function listWorkspaceRepos(
  workspaceId: string
): Promise<InstallationRepo[]> {
  const installationId = await activeGithubInstallation(workspaceId)
  if (!installationId) return []
  return listInstallationRepos(installationId)
}

// Map the repo Merlin asked for onto an actually-connected one so we never clone
// a phantom. One connected repo → use it (ignore the guess). Exact or
// unambiguous name match → use it. Otherwise return the valid list so Merlin can
// retry. Empty list → best-effort passthrough (can't validate; don't block on a
// transient enumerate failure).
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
  // Merlin sometimes guesses the wrong owner; match on the repo name alone when
  // that's unambiguous.
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

// Merlin's code-investigation tool: clone the connected GitHub repo into an
// ephemeral sandbox and run a coding agent against it, returning a synthesis
// Merlin folds into its answer. Gated on a GitHub connection + (registration-side)
// Railway being configured. `repos` (the installation's accessible repos) are
// listed in the description so Merlin targets a real one, and resolved again
// server-side so a wrong guess never clones a phantom. Emits a UsageEvent per
// run for future billing.
export function buildCodeTools(
  workspaceId: string,
  {
    onUsage,
    onToolEvent,
    repos = [],
  }: {
    onUsage?: OnUsage
    onToolEvent?: (e: MerlinToolCall) => void
    repos?: InstallationRepo[]
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
        const installationId = await activeGithubInstallation(workspaceId)
        if (!installationId) {
          return { error: "GitHub isn't connected to this workspace" }
        }

        // Resolve against the actually-connected repos before any expensive
        // work, so a wrong guess returns the valid list instead of cloning a
        // nonexistent repo.
        const resolved = resolveRepo(repo, repos)
        if ("error" in resolved) return { error: resolved.error }

        const token = await getInstallationToken(installationId).catch(
          () => null
        )
        if (!token) return { error: "couldn't authenticate with GitHub" }

        // Stream the agent's own tool calls up as nested sub-steps under this
        // investigate_code call so the user watches it explore in realtime.
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
