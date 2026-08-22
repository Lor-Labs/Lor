import { and, asc, db, desc, eq, schema } from "@repo/db"
import { generateText, isStepCount } from "ai"
import { type BrainWriteEvent, brainReadTools, brainWriteTools } from "./brain"
import { logger } from "./logger"
import { mainGatewayOptions, merlinModel } from "./models"
import type { OnUsage } from "./usage"

const SYNTHESIS_MAX_STEPS = 24
const SYNTHESIS_TIMEOUT_MS = 5 * 60_000
const MESSAGES_PER_CHANNEL = 400
const MESSAGE_CHAR_MAX = 1500
const TRANSCRIPT_CHAR_MAX = 150_000

const SYNTHESIS_INSTRUCTIONS = `You are Merlin, the archivist for a team workspace. A project has just been archived; its channels are now read-only. Your job is to distill it into durable, workspace-visible memory so future conversations anywhere in the workspace can build on what happened here.

You are given the project's metadata and its channel transcript. The project's own scoped memory folder (if any) is readable via your memory tools — consult it for notes taken during the project.

Write brain pages under the folder path you are given:
- Capture what the project set out to do, the key decisions AND their rationale, the outcome, and any follow-ups or loose ends.
- A few focused pages beat many shallow ones; one page is fine for a small project.
- Write conclusions the team should remember, not a play-by-play. Leave out sensitive interpersonal details.
- Use the link tool (supersedes / part_of / relates_to) when a page supersedes or extends existing workspace memory.

Then reply with your final message: a concise closing summary to post in the project's channel — the outcome, the key decisions, and any follow-ups. A few short paragraphs or bullets, plain markdown, no heading. Do not mention memory tools or file paths.`

// Folder segments can't contain the path separator (same rule as
// resolveMerlinRunScope).
function archiveFolderPath(projectName: string | null): string {
  return `/projects/${(projectName ?? "untitled").replaceAll("/", "-").trim()}`
}

async function loadTranscript(categoryChannelId: string): Promise<string> {
  const channels = await db
    .select({ id: schema.channel.id, name: schema.channel.name })
    .from(schema.channel)
    .where(
      and(
        eq(schema.channel.parentId, categoryChannelId),
        eq(schema.channel.type, "text")
      )
    )
    .orderBy(asc(schema.channel.position))

  const sections: string[] = []
  let budget = TRANSCRIPT_CHAR_MAX
  for (const ch of channels) {
    if (budget <= 0) break
    const rows = await db
      .select({
        content: schema.message.content,
        createdAt: schema.message.createdAt,
        threadRootId: schema.message.threadRootId,
        authorName: schema.user.name,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .where(
        and(
          eq(schema.message.channelId, ch.id),
          eq(schema.message.status, "complete")
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(MESSAGES_PER_CHANNEL)

    const lines = rows
      .reverse()
      .flatMap((m) => {
        const text = m.content?.trim()
        if (!text) return []
        const body =
          text.length > MESSAGE_CHAR_MAX
            ? `${text.slice(0, MESSAGE_CHAR_MAX)}…`
            : text
        const prefix = m.threadRootId ? "  ↳ " : ""
        return [
          `${prefix}[${m.authorName} — ${m.createdAt.toISOString().slice(0, 10)}] ${body.replaceAll("\n", "\n  ")}`,
        ]
      })
      .join("\n")
    if (!lines) continue
    const section = `## #${ch.name ?? "channel"}\n${lines}`
    sections.push(section.slice(0, Math.max(budget, 0)))
    budget -= section.length
  }
  return sections.join("\n\n")
}

/**
 * Distill an archiving project into workspace-scoped brain pages and return
 * the closing summary to post in the project's channel. Reads may reach the
 * project's scoped memory; writes are deliberately unscoped — this is the
 * promotion step that carries durable conclusions across the privacy boundary.
 */
export async function synthesizeProjectArchive(args: {
  workspaceId: string
  projectId: string
  onUsage?: OnUsage
  onMemoryWritten?: (event: BrainWriteEvent) => void
}): Promise<{ summary: string }> {
  const row = await db
    .select({
      project: schema.project,
      categoryName: schema.channel.name,
    })
    .from(schema.project)
    .innerJoin(
      schema.channel,
      eq(schema.project.categoryChannelId, schema.channel.id)
    )
    .where(eq(schema.project.id, args.projectId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) throw new Error("Project not found")

  const { project } = row
  const transcript = await loadTranscript(project.categoryChannelId)
  const folderPath = archiveFolderPath(row.categoryName)

  const meta = [
    `Project: ${row.categoryName ?? "untitled"}`,
    project.description ? `Description: ${project.description}` : null,
    project.targetDate
      ? `Target date: ${project.targetDate.toISOString().slice(0, 10)}`
      : null,
    `Started: ${project.createdAt.toISOString().slice(0, 10)}`,
    `Archived: ${new Date().toISOString().slice(0, 10)}`,
    `Write your pages under: ${folderPath}`,
  ]
    .filter(Boolean)
    .join("\n")

  const readContext = {
    workspaceId: args.workspaceId,
    scopeChannelId: project.categoryChannelId,
  }
  const result = await generateText({
    model: merlinModel,
    reasoning: "high",
    instructions: SYNTHESIS_INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: `${meta}\n\n# Transcript\n\n${transcript || "(no messages)"}`,
      },
    ],
    tools: { ...brainReadTools, ...brainWriteTools },
    toolsContext: {
      ls: readContext,
      read: readContext,
      tree: readContext,
      write: { workspaceId: args.workspaceId, onWrite: args.onMemoryWritten },
      mkdir: { workspaceId: args.workspaceId },
      move: { workspaceId: args.workspaceId },
      link: { workspaceId: args.workspaceId },
    },
    stopWhen: isStepCount(SYNTHESIS_MAX_STEPS),
    timeout: { totalMs: SYNTHESIS_TIMEOUT_MS },
    providerOptions: { gateway: mainGatewayOptions },
  })

  try {
    args.onUsage?.({
      workspaceId: args.workspaceId,
      tool: "merlin.project_archive",
      model: result.response.modelId,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.outputTokenDetails.reasoningTokens,
    })
  } catch (err) {
    logger.warn(
      { err, projectId: args.projectId },
      "Archive usage capture failed"
    )
  }

  return { summary: result.text.trim() }
}
