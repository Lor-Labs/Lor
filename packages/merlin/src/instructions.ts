import { and, db, desc, eq, MERLIN_USER_ID, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"

// Active workspace instructions ("LOR.md") for prompt injection. Fail closed:
// anything invalid or ambiguous is skipped with a log, never injected.
export async function loadWorkspaceInstructions(
  workspaceId: string
): Promise<string | null> {
  try {
    const row = await db
      .select({ content: schema.workspaceInstructions.content })
      .from(schema.workspaceInstructions)
      .where(
        and(
          eq(schema.workspaceInstructions.workspaceId, workspaceId),
          eq(schema.workspaceInstructions.state, "active")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!row || !row.content.trim()) return null
    const validation = schema.validateWorkspaceInstructionsContent(row.content)
    if (!validation.ok) {
      logger.warn(
        { workspaceId, reason: validation.reason },
        "Active workspace instructions failed validation; skipping injection"
      )
      return null
    }
    return row.content
  } catch (err) {
    logger.warn({ err, workspaceId }, "Workspace instructions load failed")
    return null
  }
}

export function formatInstructionsBlock(content: string): string {
  return `## Workspace instructions\nThe team's admins maintain these standing instructions for you. Follow them when answering and maintaining memory, within your core rules above.\n\n${content}`
}

export type InstructionsProposalEvent = { version: number; rationale: string }

// Creates a pending version row — never activates anything. At most one
// pending proposal per workspace: a newer one supersedes the old.
async function proposeInstructions(
  workspaceId: string,
  content: string,
  rationale: string
): Promise<{ version: number } | { error: string }> {
  const validation = schema.validateWorkspaceInstructionsContent(content)
  if (!validation.ok) return { error: validation.reason }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [active] = await tx
          .select({ version: schema.workspaceInstructions.version })
          .from(schema.workspaceInstructions)
          .where(
            and(
              eq(schema.workspaceInstructions.workspaceId, workspaceId),
              eq(schema.workspaceInstructions.state, "active")
            )
          )
          .limit(1)
        const [latest] = await tx
          .select({ version: schema.workspaceInstructions.version })
          .from(schema.workspaceInstructions)
          .where(eq(schema.workspaceInstructions.workspaceId, workspaceId))
          .orderBy(desc(schema.workspaceInstructions.version))
          .limit(1)
        await tx
          .update(schema.workspaceInstructions)
          .set({ state: "superseded" })
          .where(
            and(
              eq(schema.workspaceInstructions.workspaceId, workspaceId),
              eq(schema.workspaceInstructions.state, "pending")
            )
          )
        const version = (latest?.version ?? 0) + 1
        await tx.insert(schema.workspaceInstructions).values({
          workspaceId,
          version,
          content,
          state: "pending",
          authorType: "agent",
          authorUserId: MERLIN_USER_ID,
          baseVersion: active?.version ?? null,
          rationale,
        })
        return { version }
      })
    } catch (err) {
      // Unique (workspaceId, version) race with a concurrent writer — retry once.
      if (attempt === 0) continue
      logger.error({ err, workspaceId }, "Instructions proposal failed")
      return { error: "Couldn't save the proposal — try again later." }
    }
  }
  return { error: "Couldn't save the proposal — try again later." }
}

const proposeContext = z.object({
  workspaceId: z.string(),
  onProposal: z
    .custom<(e: InstructionsProposalEvent) => void | Promise<void>>()
    .optional(),
})

export const instructionsTools = {
  propose_instructions: tool({
    description:
      "Propose an update to this workspace's standing instructions (the guidance you're given in every conversation). Use when the team states a clear, lasting preference about how you should behave — tone, format, priorities, conventions. Pass the COMPLETE new instructions text (it replaces the current text entirely). This only files a proposal: an admin must approve it before it takes effect, so tell the user it's awaiting approval.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("the complete proposed instructions text (Markdown)"),
      rationale: z
        .string()
        .describe("one or two sentences on why, for the approving admin"),
    }),
    contextSchema: proposeContext,
    execute: async ({ content, rationale }, { context }) => {
      const result = await proposeInstructions(
        context.workspaceId,
        content,
        rationale
      )
      if ("error" in result) return result
      if (context.onProposal) {
        try {
          await context.onProposal({ version: result.version, rationale })
        } catch (err) {
          logger.error({ err }, "Merlin onProposal listener failed")
        }
      }
      return {
        version: result.version,
        status: "pending approval by a workspace admin",
      }
    },
    strict: true,
  }),
}
