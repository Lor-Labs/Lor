import {
  approvalTargetKey,
  builtinApprovalTool,
  CONNECTOR_TOOLS,
} from "@repo/connectors"
import { and, asc, db, desc, eq, schema } from "@repo/db"
import {
  EMPTY_LOR_RUN_SCOPE,
  memoryFolderSegment,
  resolveLorRunScope,
} from "@repo/db/queries/channel-access"
import type { LorToolCallUpdate } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { isStepCount, streamText } from "ai"
import { loadApprovalGates } from "./approval-policy"
import { attioTools, resolveWorkspaceAttio } from "./attio"
import { type BrainWriteEvent, brainReadTools, brainWriteTools } from "./brain"
import { EMPTY_TOOL_GRANTS, resolveChannelCapabilities } from "./capabilities"
import { cloudwatchTools, resolveWorkspaceCloudwatch } from "./cloudwatch"
import { codeTools } from "./code"
import { datadogMcpTools, resolveWorkspaceDatadog } from "./datadog"
import { githubTools, resolveWorkspaceGithub } from "./github"
import { chatTools, searchTools, toolDetail, toolLabel } from "./index"
import { linearTools, resolveWorkspaceLinear } from "./linear"
import { logger } from "./logger"
import { lorModel, mainGatewayOptions } from "./models"
import { notionTools, resolveWorkspaceNotion } from "./notion"
import { blaxelConfigured } from "./sandbox/blaxel"
import { sourceTools } from "./sources"
import type { OnUsage } from "./usage"
import { webTools } from "./web"

const SYNTHESIS_TIMEOUT_MS = 15 * 60_000
const MESSAGES_PER_CHANNEL = 400
const MESSAGE_CHAR_MAX = 1500
const TRANSCRIPT_CHAR_MAX = 150_000

const SYNTHESIS_INSTRUCTIONS = `You are Lor, the archivist for a team workspace. A project has just been archived; its channels are now read-only. Your job is to distill it into durable, workspace-visible memory so future conversations anywhere in the workspace can build on what happened here.

You are given the project's metadata and its channel transcript. The project's own scoped memory folder (if any) is readable via your memory tools — consult it for notes taken during the project. Where the team's connected tools are available, verify what actually happened rather than relying on the transcript alone: read the pull requests that merged, the tickets that closed, the code that shipped.

Write brain pages under the folder path you are given:
- Capture what the project set out to do, the key decisions AND their rationale, the outcome, and any follow-ups or loose ends.
- A few focused pages beat many shallow ones; one page is fine for a small project.
- Write conclusions the team should remember, not a play-by-play. Leave out sensitive interpersonal details.
- Use the memory_link tool (supersedes / part_of / relates_to) when a page supersedes or extends existing workspace memory. A decision that replaces an earlier one goes on its own page, linked supersedes from the new page to the old one; never rewrite the old decision.

Then reply with your final message: a concise closing summary to post in the project's channel — the outcome, the key decisions, and any follow-ups. A few short paragraphs or bullets, plain markdown, no heading. Do not mention memory tools or file paths.`

export type ArchiveSynthesisCallbacks = {
  onToolEvent?: (e: LorToolCallUpdate) => void
  onMemoryWritten?: (e: BrainWriteEvent) => void
  onUsage?: OnUsage
}

// Same folder naming rule as resolveLorRunScope.
function archiveFolderPath(projectName: string | null): string {
  return `/projects/${memoryFolderSegment(projectName)}`
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
  // One query per channel: the per-channel message LIMIT would need a
  // window function to batch, and a project's channel count is small.
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
    const pushed = section.slice(0, Math.max(budget, 0))
    sections.push(pushed)
    budget -= pushed.length
  }
  return sections.join("\n\n")
}

/**
 * Distill an archiving project into workspace-scoped brain pages and return
 * the closing summary. Deliberately separate from respond(): no run row, no
 * stop/steer, no streaming deltas — but the same read-only connector reach
 * (GitHub, Linear, logs, web, …) bound from the closing channel's
 * capabilities, so it can verify what actually shipped. Retrieval mirrors a
 * run in the project (reads may reach the private container + scoped memory);
 * brain WRITES are unscoped — the promotion step that carries durable
 * conclusions across the privacy boundary.
 */
export async function synthesizeProjectArchive(
  args: {
    workspaceId: string
    projectId: string
    // Capabilities anchor — a project channel; synthesis binds the connector
    // tools a run in that channel would get. Null = core tools only.
    channelId: string | null
  },
  { onToolEvent, onMemoryWritten, onUsage }: ArchiveSynthesisCallbacks = {}
): Promise<{ summary: string }> {
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
  const [transcript, runScope, grants] = await Promise.all([
    loadTranscript(project.categoryChannelId),
    args.channelId
      ? resolveLorRunScope(args.channelId).catch(() => EMPTY_LOR_RUN_SCOPE)
      : EMPTY_LOR_RUN_SCOPE,
    args.channelId
      ? resolveChannelCapabilities(args.channelId, args.workspaceId).catch(
          () => EMPTY_TOOL_GRANTS
        )
      : Promise.resolve(EMPTY_TOOL_GRANTS),
  ])
  const allowedBuiltins = new Set(grants.builtinTools)
  const allowed = new Set(grants.connectorTools)
  const needsConnector = (provider: keyof typeof CONNECTOR_TOOLS) =>
    CONNECTOR_TOOLS[provider].some(
      (tool) => tool.readOnlyHint && allowed.has(tool.name)
    )

  // Read-only connector binding — keep in sync with respond()'s toolset (no
  // write tools, no plan/artifact/message-action tools here).
  const needsGithub = needsConnector("github")
  const [github, linear, attio, notion, datadogMcp, cloudwatch] =
    await Promise.all([
      needsGithub
        ? resolveWorkspaceGithub(args.workspaceId).catch(() => null)
        : null,
      needsConnector("linear")
        ? resolveWorkspaceLinear(args.workspaceId).catch(() => null)
        : null,
      needsConnector("attio")
        ? resolveWorkspaceAttio(args.workspaceId).catch(() => null)
        : null,
      needsConnector("notion")
        ? resolveWorkspaceNotion(args.workspaceId).catch(() => null)
        : null,
      needsConnector("datadog")
        ? resolveWorkspaceDatadog(args.workspaceId)
            .then((d) => (d ? datadogMcpTools(d.externalId) : null))
            .catch(() => null)
        : null,
      needsConnector("cloudwatch")
        ? resolveWorkspaceCloudwatch(args.workspaceId).catch(() => null)
        : null,
    ])

  try {
    const tools = {
      ...searchTools,
      ...chatTools,
      ...sourceTools,
      ...brainReadTools,
      ...brainWriteTools,
      ...(env.EXA_API_KEY ? webTools : {}),
      ...(github ? githubTools : {}),
      ...(blaxelConfigured() && github ? codeTools : {}),
      ...(linear ? linearTools : {}),
      ...(attio ? attioTools : {}),
      ...(notion ? notionTools : {}),
      ...(datadogMcp ? datadogMcp.tools : {}),
      ...(cloudwatch ? cloudwatchTools : {}),
    }

    const connectorNames = new Set([
      ...Object.keys(githubTools),
      ...Object.keys(codeTools),
      ...Object.keys(linearTools),
      ...Object.keys(attioTools),
      ...Object.keys(notionTools),
      ...Object.keys(cloudwatchTools),
      ...Object.keys(datadogMcp?.tools ?? {}),
    ])
    const approvalGates = await loadApprovalGates(args.workspaceId)
    for (const name of Object.keys(tools)) {
      // Background synthesis cannot request human approval.
      const gated =
        builtinApprovalTool(name) !== null &&
        approvalGates.has(
          approvalTargetKey({ kind: "builtinTool", toolName: name })
        )
      if (
        (connectorNames.has(name) && !allowed.has(name)) ||
        (Object.hasOwn(webTools, name) && !allowedBuiltins.has(name)) ||
        gated
      )
        delete (tools as Record<string, unknown>)[name]
    }

    const readContext = {
      workspaceId: args.workspaceId,
      scopeChannelId: runScope.memoryScopeChannelId,
    }
    const retrieval = {
      workspaceId: args.workspaceId,
      privateContainerChannelId: runScope.privateContainerChannelId,
    }
    const toolsContext = {
      search: {
        ...retrieval,
        memoryScopeChannelId: runScope.memoryScopeChannelId,
        onUsage,
      },
      read_thread: retrieval,
      view_image: retrieval,
      read_attachment: retrieval,
      read_call: retrieval,
      fetch_source: retrieval,
      memory_ls: readContext,
      memory_read: readContext,
      memory_tree: readContext,
      memory_write: {
        workspaceId: args.workspaceId,
        onWrite: onMemoryWritten,
      },
      memory_edit: { workspaceId: args.workspaceId, onWrite: onMemoryWritten },
      memory_mkdir: { workspaceId: args.workspaceId },
      memory_move: { workspaceId: args.workspaceId },
      memory_link: { workspaceId: args.workspaceId },
      ...(github
        ? {
            search_github: {
              ...github,
              workspaceId: args.workspaceId,
              onUsage,
            },
            fetch_github: github,
            investigate_code: {
              workspaceId: args.workspaceId,
              installationId: github.installationId,
              repos: github.repos,
              onUsage,
              onToolEvent,
            },
          }
        : {}),
      ...(linear
        ? {
            search_linear: {
              ...linear,
              workspaceId: args.workspaceId,
              onUsage,
            },
            list_linear_issues: linear,
            fetch_linear: linear,
          }
        : {}),
      ...(attio
        ? {
            search_attio: {
              ...attio,
              workspaceId: args.workspaceId,
              onUsage,
            },
            fetch_attio_record: attio,
            query_attio: attio,
            fetch_attio_activity: attio,
          }
        : {}),
      ...(notion
        ? {
            search_notion: {
              ...notion,
              workspaceId: args.workspaceId,
              onUsage,
            },
            fetch_notion_page: notion,
            query_notion_data_source: notion,
            list_notion_users: notion,
          }
        : {}),
      ...(cloudwatch
        ? {
            list_cloudwatch_log_groups: cloudwatch,
            search_cloudwatch_logs: cloudwatch,
            list_cloudwatch_metrics: cloudwatch,
            get_cloudwatch_metrics: cloudwatch,
          }
        : {}),
    }

    const connectors = [
      github && "GitHub (code, PRs)",
      linear && "Linear (issues)",
      attio && "Attio (CRM)",
      notion && "Notion",
      datadogMcp && "Datadog",
      cloudwatch && "CloudWatch",
      Object.keys(webTools).some((name) => Object.hasOwn(tools, name)) &&
        "web search",
    ].filter(Boolean)
    const connectorLine = connectors.length
      ? `\n\nConnected tools available to verify against: ${connectors.join(", ")}.`
      : ""

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

    const result = streamText({
      model: lorModel,
      reasoning: "high",
      instructions: `${SYNTHESIS_INSTRUCTIONS}${connectorLine}`,
      messages: [
        {
          role: "user",
          content: `${meta}\n\n# Transcript\n\n${transcript || "(no messages)"}`,
        },
      ],
      tools,
      toolsContext,
      maxRetries: env.AGENT_RUN_MAX_PROVIDER_RETRIES,
      stopWhen: isStepCount(env.AGENT_RUN_MAX_STEPS),
      timeout: { totalMs: SYNTHESIS_TIMEOUT_MS },
      providerOptions: { gateway: mainGatewayOptions },
    })

    // No deltas streamed anywhere — but tool calls fan out live so the
    // channel's tool trail shows the archivist working.
    let text = ""
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.text
      } else if (part.type === "tool-call") {
        onToolEvent?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          label: toolLabel(part.toolName, part.input),
          at: 0,
        })
      } else if (part.type === "tool-result") {
        onToolEvent?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          label: toolLabel(part.toolName, part.input),
          at: 0,
          ...toolDetail(part.toolName, part.output),
        })
      } else if (part.type === "error") {
        throw part.error
      }
    }

    try {
      const [usage, response] = await Promise.all([
        result.totalUsage,
        result.response,
      ])
      onUsage?.({
        workspaceId: args.workspaceId,
        tool: "lor.project_archive",
        model: response.modelId,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens,
      })
    } catch (err) {
      logger.warn(
        { err, projectId: args.projectId },
        "Archive usage capture failed"
      )
    }

    return { summary: text.trim() }
  } finally {
    await datadogMcp?.close().catch(() => {})
  }
}
