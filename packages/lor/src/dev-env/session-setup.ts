import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  CODE_SANDBOX_MEMORY_OPTIONS_MB,
  effectiveSandboxMemoryMb,
} from "./environments"

// suggest_session_setup (LOR-156): Lor suggests a code session's environment
// or sandbox size; the tool's result shows as a card in the session, and a
// person applies it (PATCH /sessions/{id}/setup). Lor never applies it.

const sessionSetupContext = z.object({
  workspaceId: z.string(),
  threadRootId: z.string(),
})

const SIZES_GB = CODE_SANDBOX_MEMORY_OPTIONS_MB.map((mb) => mb / 1024)

export const sessionSetupTool = {
  suggest_session_setup: tool({
    description: `Suggest a different environment (the env files Lor writes into the work folder) or sandbox size for this code session. Shows a card with an Apply button in the session; a person applies it. Sizes: ${SIZES_GB.join(" or ")} GB. Applying a new size replaces the sandbox: the work folder comes back from your last turn, and installed packages, running servers and files outside the repo are gone. Fails when the environment doesn't exist for this repo (the error lists those that do) or the session already uses the suggestion.`,
    inputSchema: z.object({
      environment: z
        .string()
        .nullable()
        .describe(
          "an environment's name for this repo, or null to keep the current one"
        ),
      sandboxMemoryGb: z
        .number()
        .int()
        .nullable()
        .describe(
          `the sandbox size in GB (${SIZES_GB.join(" or ")}), or null to keep the current size`
        ),
      reason: z
        .string()
        .min(1)
        .max(300)
        .describe("one sentence for the card: why this helps"),
    }),
    contextSchema: sessionSetupContext,
    execute: async ({ environment, sandboxMemoryGb, reason }, { context }) => {
      const [session] = await db
        .select({
          id: schema.agentSession.id,
          repoFullName: schema.agentSession.repoFullName,
          environmentId: schema.agentSession.environmentId,
          sandboxMemoryMb: schema.agentSession.sandboxMemoryMb,
        })
        .from(schema.agentSession)
        .where(
          and(
            eq(schema.agentSession.threadRootId, context.threadRootId),
            eq(schema.agentSession.workspaceId, context.workspaceId)
          )
        )
        .limit(1)
      if (!session?.repoFullName) {
        return { error: "Only code sessions have an environment and size" }
      }
      const repo = session.repoFullName
      if (environment === null && sandboxMemoryGb === null) {
        return { error: "Suggest an environment, a size, or both" }
      }

      let picked: { id: string; name: string } | null = null
      if (environment !== null) {
        const environments = await db
          .select({ id: schema.environment.id, name: schema.environment.name })
          .from(schema.environment)
          .innerJoin(
            schema.environmentRepo,
            eq(schema.environmentRepo.environmentId, schema.environment.id)
          )
          .where(
            and(
              eq(schema.environment.workspaceId, context.workspaceId),
              eq(schema.environmentRepo.repoFullName, repo)
            )
          )
        const wanted = environment.trim().toLowerCase()
        picked =
          environments.find((env) => env.name.toLowerCase() === wanted) ?? null
        if (!picked) {
          return {
            error:
              environments.length === 0
                ? `No environment exists for ${repo}. Someone who manages environments can create one from the session menu's Environment & sandbox.`
                : `No environment named "${environment}" for ${repo}. Environments: ${environments.map((env) => env.name).join(", ")}`,
          }
        }
      }

      const sandboxMemoryMb =
        sandboxMemoryGb === null ? null : sandboxMemoryGb * 1024
      if (
        sandboxMemoryMb !== null &&
        !(CODE_SANDBOX_MEMORY_OPTIONS_MB as readonly number[]).includes(
          sandboxMemoryMb
        )
      ) {
        return { error: `Sizes are ${SIZES_GB.join(" or ")} GB` }
      }
      const environmentId = picked?.id ?? session.environmentId
      const currentMb = await effectiveSandboxMemoryMb(session)
      const nextMb =
        sandboxMemoryMb ??
        (await effectiveSandboxMemoryMb({
          sandboxMemoryMb: session.sandboxMemoryMb,
          environmentId,
        }))
      const newEnvironment = picked && picked.id !== session.environmentId
      const newSize = sandboxMemoryMb !== null && nextMb !== currentMb
      if (!newEnvironment && !newSize) {
        return {
          error: `This session already uses that (${currentMb / 1024} GB sandbox).`,
        }
      }
      return {
        ok: true as const,
        suggestion: {
          sessionId: session.id,
          ...(newEnvironment && picked
            ? { environmentId: picked.id, environmentName: picked.name }
            : {}),
          ...(newSize ? { sandboxMemoryMb } : {}),
          reason,
        },
        note: "The card is in the session. Point people at it; nothing changes until someone applies it.",
      }
    },
  }),
}
