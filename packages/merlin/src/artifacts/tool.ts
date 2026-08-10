import { and, db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import type { MerlinToolCall } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "../logger"
import {
  deleteWorkbenchCheckpoint,
  runWorkbenchSession,
  type WorkbenchInput,
  type WorkbenchTaskContinuity,
} from "../sandbox/workbench"
import { toolExecutionKey } from "../tool-guard"
import type { OnUsage } from "../usage"
import { artifactPublicUrl, writeArtifactVersion } from "./service"

// A session must have this much wall clock left to be worth starting: the
// tools-off margin only triggers between steps, so the tool bounds itself.
const MIN_REMAINING_MS = 4 * 60_000
const FINISH_MARGIN_MS = 2 * 60_000
const MAX_INPUT_FILES = 20

const artifactsContext = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  // Task runs get continuity: checkpoint boot, Pi session resume, artifact
  // reseeding. Null for plain-answer sessions.
  task: z.custom<{ id: string; sandboxCheckpoint: string | null } | null>(),
  deadlineAt: z.custom<Date>().optional(),
  onUsage: z.custom<OnUsage>().optional(),
  onToolEvent: z.custom<(e: MerlinToolCall) => void>().optional(),
})

// Current versions of the task's artifacts, reseeded into /workspace/out so
// the agent always works from artifact truth (humans may have edited).
async function loadTaskOutSeed(
  taskId: string
): Promise<WorkbenchTaskContinuity["outSeed"]> {
  const rows = await db
    .select({
      path: schema.artifact.path,
      blobKey: schema.artifactVersion.blobKey,
      size: schema.artifactVersion.size,
    })
    .from(schema.artifact)
    .innerJoin(
      schema.artifactVersion,
      and(
        eq(schema.artifactVersion.artifactId, schema.artifact.id),
        eq(schema.artifactVersion.version, schema.artifact.currentVersion)
      )
    )
    .where(eq(schema.artifact.taskId, taskId))
  const seeds: WorkbenchTaskContinuity["outSeed"] = []
  let total = 0
  for (const row of rows) {
    if (
      row.size > env.MERLIN_WORKBENCH_MAX_FILE_BYTES ||
      total + row.size > env.MERLIN_WORKBENCH_MAX_TOTAL_BYTES
    ) {
      continue
    }
    try {
      const res = await fetch(artifactPublicUrl(row.blobKey))
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      total += bytes.byteLength
      seeds.push({ path: row.path, bytes })
    } catch {
      // Missing blob degrades to a cold file, never fails the session.
    }
  }
  return seeds
}

// Only files from our own bucket (message attachments, prior artifacts) can
// seed a session — the model can't point the worker at arbitrary URLs.
function invalidInputUrl(url: string): boolean {
  return !url.startsWith(`${env.S3_PUBLIC_URL}/`)
}

async function fetchInput(url: string): Promise<WorkbenchInput | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > env.MERLIN_WORKBENCH_MAX_FILE_BYTES) return null
    const filename = decodeURIComponent(
      new URL(url).pathname.split("/").pop() || "input"
    )
    return { filename, bytes }
  } catch {
    return null
  }
}

export const artifactTools = {
  create_artifacts: tool({
    description:
      "Produce deliverable files for the team: reports, cleaned or analyzed data, generated documents or code. Runs a coding agent in a clean sandbox with Python (pandas, matplotlib, openpyxl); it works on real files and every file it delivers is stored and returned as a link. Slow and for real file outputs only — never for ordinary chat answers. Pass complete, self-contained instructions (the agent cannot ask follow-ups), including desired filenames and formats. Files people shared in the conversation appear as [file: …] lines with URLs — pass those URLs as inputs when the work needs them.",
    inputSchema: z.object({
      instructions: z
        .string()
        .describe(
          "complete instructions for the deliverables: contents, format, and filenames"
        ),
      inputFileUrls: z
        .array(z.string())
        .max(MAX_INPUT_FILES)
        .optional()
        .describe(
          "URLs of files from the conversation to use as inputs (from [file: …] lines)"
        ),
    }),
    contextSchema: artifactsContext,
    execute: async (
      { instructions, inputFileUrls },
      { toolCallId, context, abortSignal }
    ) => {
      const remainingMs = context.deadlineAt
        ? context.deadlineAt.getTime() - Date.now()
        : null
      if (remainingMs !== null && remainingMs < MIN_REMAINING_MS) {
        return {
          error:
            "not enough time left in this run for a workbench session; answer with what you have and suggest re-asking",
        }
      }
      const timeoutSec = Math.min(
        env.MERLIN_WORKBENCH_TIMEOUT_SEC,
        remainingMs !== null
          ? Math.floor((remainingMs - FINISH_MARGIN_MS) / 1000)
          : env.MERLIN_WORKBENCH_TIMEOUT_SEC
      )

      // Stable per-input identity: recovery replays the stored manifest
      // instead of re-running the sandbox or re-billing.
      const billingKey = toolExecutionKey("create_artifacts", {
        instructions,
        inputFileUrls,
      })

      const urls = inputFileUrls ?? []
      const badUrl = urls.find(invalidInputUrl)
      if (badUrl) {
        return {
          error: `input file URL is not a workspace file: ${badUrl}. Only URLs from [file: …] lines in the conversation can be used.`,
        }
      }
      const inputs: WorkbenchInput[] = []
      for (const url of urls) {
        const input = await fetchInput(url)
        if (!input) {
          return { error: `couldn't fetch input file: ${url}` }
        }
        inputs.push(input)
      }

      let step = 0
      const result = await runWorkbenchSession({
        instructions,
        inputs,
        timeoutSec,
        abortSignal,
        ...(context.task
          ? {
              task: {
                id: context.task.id,
                bootCheckpoint: context.task.sandboxCheckpoint,
                outSeed: await loadTaskOutSeed(context.task.id),
              },
            }
          : {}),
        onStep: (s) => {
          step += 1
          // A failing listener must not abort or fail the session.
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
        return { error: result?.error ?? "workbench session failed" }
      }

      if (result.usage) {
        try {
          context.onUsage?.({
            workspaceId: context.workspaceId,
            tool: "create_artifacts",
            billingKey,
            model: result.usage.model,
            requestedModel: result.usage.requestedModel,
            inputTokens: result.usage.inputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.reasoningTokens,
            metadata: { files: result.files.length },
          })
        } catch (err) {
          logger.error({ err }, "Merlin onUsage listener failed")
        }
      }

      // Persist the new checkpoint pointer, then retire the superseded one —
      // only if the pointer actually moved, or we'd delete the checkpoint the
      // task still boots from.
      if (context.task && result.checkpoint) {
        const previous = context.task.sandboxCheckpoint
        const updated = await db
          .update(schema.task)
          .set({ sandboxCheckpoint: result.checkpoint })
          .where(eq(schema.task.id, context.task.id))
          .then(() => true)
          .catch((err) => {
            logger.warn({ err }, "Workbench: checkpoint pointer update failed")
            return false
          })
        if (updated && previous && previous !== result.checkpoint) {
          void deleteWorkbenchCheckpoint(previous)
        }
      }

      try {
        const manifest = []
        for (const file of result.files) {
          manifest.push(
            await writeArtifactVersion({
              workspaceId: context.workspaceId,
              channelId: context.channelId,
              taskId: context.task?.id ?? null,
              path: file.path,
              contentType: file.contentType,
              bytes: file.bytes,
              authorType: "agent",
              authorId: MERLIN_USER_ID,
            })
          )
        }
        return {
          files: manifest.map((m) => ({
            path: m.path,
            contentType: m.contentType,
            size: m.size,
            version: m.version,
            artifactId: m.artifactId,
            url: m.url,
          })),
          summary: result.summary,
          ...(result.skipped.length
            ? {
                note: `some output files exceeded size caps and were dropped: ${result.skipped.join(", ")}`,
              }
            : {}),
          ...(result.failure
            ? {
                warning: `the workbench session ${result.failure} before finishing. Any files listed above were still delivered, and the workspace (scripts, parsed data, progress) is preserved. Call create_artifacts again — reword the instructions to say what remains to be done — and the agent will continue from where it left off instead of starting over.`,
              }
            : {}),
        }
      } catch (err) {
        logger.error({ err }, "Workbench: artifact persistence failed")
        return { error: "produced files couldn't be stored; try again" }
      }
    },
    strict: true,
  }),
}
