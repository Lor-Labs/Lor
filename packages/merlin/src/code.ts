import { and, db, eq, schema } from "@repo/db"
import type { MerlinToolCall } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import { getInstallationToken } from "./providers/github"
import { investigateCode } from "./sandbox/investigate"
import type { OnUsage } from "./usage"

// Merlin's code-investigation tool: clone the connected GitHub repo into an
// ephemeral sandbox and run a coding agent against it, returning a synthesis
// Merlin folds into its answer. Gated on a GitHub connection + (registration-side)
// Railway being configured. Emits a UsageEvent per run for future billing.
export function buildCodeTools(
  workspaceId: string,
  {
    onUsage,
    onToolEvent,
  }: { onUsage?: OnUsage; onToolEvent?: (e: MerlinToolCall) => void }
) {
  return {
    investigate_code: tool({
      description:
        "Investigate the team's connected GitHub codebase to answer a code-level question — how something works, where it's implemented, or to trace a bug. Clones the repo into a sandbox and runs a coding agent to explore it (slow; use only when the answer genuinely needs the source, not for PRs/issues). Pass the repo as 'owner/repo' and a specific question.",
      inputSchema: z.object({
        repo: z.string().describe("the repository as owner/repo"),
        question: z
          .string()
          .describe("the specific code question to investigate"),
      }),
      execute: async ({ repo, question }, { toolCallId }) => {
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
        if (!connection) {
          return { error: "GitHub isn't connected to this workspace" }
        }

        const token = await getInstallationToken(connection.externalId).catch(
          () => null
        )
        if (!token) return { error: "couldn't authenticate with GitHub" }

        // Stream the agent's own tool calls up as nested sub-steps under this
        // investigate_code call so the user watches it explore in realtime.
        let step = 0
        const result = await investigateCode({
          repoFullName: repo,
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
            metadata: { repo },
          })
        }

        return { repo, findings: result.findings }
      },
      strict: true,
    }),
  }
}
