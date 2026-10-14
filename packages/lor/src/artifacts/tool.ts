import { and, db, eq, LOR_USER_ID, schema } from "@repo/db"
import type { LorToolCallUpdate } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "../logger"
import { createSessionSerializer } from "../sandbox/serialize"
import { subagentToolEvents } from "../sandbox/sub-events"
import {
  runWorkbenchSession,
  type WorkbenchContinuity,
  type WorkbenchInput,
} from "../sandbox/workbench"
import { toolExecutionKey } from "../tool-guard"
import type { OnUsage } from "../usage"
import { artifactPublicUrl, writeArtifactVersion } from "./service"

// A session must have this much wall clock left to be worth starting: the
// tools-off margin only triggers between steps, so the tool bounds itself.
const MIN_REMAINING_MS = 4 * 60_000
const FINISH_MARGIN_MS = 2 * 60_000
const MAX_INPUT_FILES = 20
const FETCH_TIMEOUT_MS = 30_000

const artifactsContext = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  // Thread-scope runs get continuity: the scope's persistent sandbox + Pi
  // session resume. Null = ephemeral (channel-scope one-shots).
  sandboxKey: z.custom<string | null>(),
  // The session that owns the files: /workspace/out is reseeded from its
  // artifacts and a rewritten path versions the same artifact.
  threadRootId: z.custom<string | null>(),
  // Provenance for new artifacts. A getter because the plan may start
  // mid-run (start_plan).
  getPlan: z.custom<() => { id: string } | null>(),
  deadlineAt: z.custom<Date>().optional(),
  onUsage: z.custom<OnUsage>().optional(),
  onToolEvent: z.custom<(e: LorToolCallUpdate) => void>().optional(),
})

const serializeWorkbenchSession = createSessionSerializer()

// Current versions of the session's artifacts, reseeded into /workspace/out
// so the agent always works from artifact truth (humans may have edited).
async function loadSessionOutSeed(
  threadRootId: string
): Promise<WorkbenchContinuity["outSeed"]> {
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
    .where(eq(schema.artifact.threadRootId, threadRootId))
  const seeds: WorkbenchContinuity["outSeed"] = []
  let total = 0
  for (const row of rows) {
    if (
      row.size > env.LOR_WORKBENCH_MAX_FILE_BYTES ||
      total + row.size > env.LOR_WORKBENCH_MAX_TOTAL_BYTES
    ) {
      continue
    }
    try {
      const res = await fetch(artifactPublicUrl(row.blobKey), {
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
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
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const declared = Number(res.headers.get("content-length"))
    if (
      Number.isFinite(declared) &&
      declared > env.LOR_WORKBENCH_MAX_FILE_BYTES
    ) {
      return null
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > env.LOR_WORKBENCH_MAX_FILE_BYTES) return null
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
      // Re-derived when the session actually starts: a plan session can wait
      // behind a sibling call, and the deadline moves on meanwhile.
      const sessionBudget = (): { timeoutSec: number } | { error: string } => {
        const remainingMs = context.deadlineAt
          ? context.deadlineAt.getTime() - Date.now()
          : null
        if (remainingMs !== null && remainingMs < MIN_REMAINING_MS) {
          return {
            error:
              "not enough time left in this run for a workbench session; answer with what you have and suggest re-asking",
          }
        }
        return {
          timeoutSec: Math.min(
            env.LOR_WORKBENCH_TIMEOUT_SEC,
            remainingMs !== null
              ? Math.floor((remainingMs - FINISH_MARGIN_MS) / 1000)
              : env.LOR_WORKBENCH_TIMEOUT_SEC
          ),
        }
      }
      const upfrontBudget = sessionBudget()
      if ("error" in upfrontBudget) return upfrontBudget

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

      const sandboxKey = context.sandboxKey
      const startSession = async () => {
        const budget = sessionBudget()
        if ("error" in budget) return budget
        // Loaded after the session-queue wait, so files a queued sibling
        // call just wrote are in the seed.
        const { threadRootId } = context
        return runWorkbenchSession({
          instructions,
          inputs,
          timeoutSec: budget.timeoutSec,
          abortSignal,
          ...(sandboxKey
            ? {
                continuity: {
                  sandboxKey,
                  outSeed: threadRootId
                    ? await loadSessionOutSeed(threadRootId)
                    : [],
                },
              }
            : {}),
          ...subagentToolEvents({
            parentToolCallId: toolCallId,
            onToolEvent: context.onToolEvent,
          }),
        })
      }
      const result = await (sandboxKey
        ? serializeWorkbenchSession(sandboxKey, startSession)
        : startSession()
      ).catch((err) => {
        logger.error({ err, sandboxKey }, "Workbench: session threw")
        return null
      })
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
          logger.error({ err }, "Lor onUsage listener failed")
        }
      }

      // Per-file persistence: a failure mid-list must not hide the files that
      // WERE stored (their versions are committed and visible), or the model
      // re-runs the whole session for deliverables it already has. Plan
      // re-read so a start_plan that landed mid-session still gets credit.
      const plan = context.getPlan()
      const manifest = []
      const unstored: string[] = []
      for (const file of result.files) {
        try {
          manifest.push(
            await writeArtifactVersion({
              workspaceId: context.workspaceId,
              channelId: context.channelId,
              threadRootId: context.threadRootId,
              planId: plan?.id ?? null,
              path: file.path,
              contentType: file.contentType,
              bytes: file.bytes,
              authorType: "agent",
              authorId: LOR_USER_ID,
            })
          )
        } catch (err) {
          logger.error(
            { err, path: file.path },
            "Workbench: artifact persistence failed"
          )
          unstored.push(file.path)
        }
      }
      if (result.files.length > 0 && manifest.length === 0) {
        return { error: "produced files couldn't be stored; try again" }
      }
      const warnings = [
        ...(unstored.length
          ? [
              `these produced files could not be stored and were NOT delivered: ${unstored.join(", ")}. Call create_artifacts again to reproduce just those files.`,
            ]
          : []),
        ...(result.failure
          ? [
              `the workbench session ${result.failure} before finishing. Any files listed above were still delivered, and the workspace (scripts, parsed data, progress) is preserved. Call create_artifacts again — reword the instructions to say what remains to be done — and the agent will continue from where it left off instead of starting over.`,
            ]
          : []),
      ]
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
        ...(warnings.length ? { warning: warnings.join("\n") } : {}),
      }
    },
    strict: true,
  }),
}
