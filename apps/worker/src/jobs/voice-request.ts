import { setTimeout as sleep } from "node:timers/promises"
import { checkCredits, recordUsage } from "@repo/billing"
import { db, desc, eq, isUniqueViolation, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { type ConversationTurn, respond } from "@repo/lor"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import type { VoiceRequestJobData } from "@repo/realtime-types/queues"
import {
  finishVoiceRequest,
  listRecentCallLines,
  loadVoiceRequest,
  notifyVoiceRequest,
  setVoiceRequestResult,
  startVoiceRequest,
} from "@repo/voice/server"
import type { Job } from "bullmq"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import { logger } from "@/lib/logger"
import { cancelPendingRun } from "@/lib/unattended-run"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// A request in a call is bounded to the call, not the 2h default.
const VOICE_RUN_WALL_MS = 10 * 60_000
// One run per call at a time (scopeKey = session). A request that arrives
// while another runs waits for it; steering replaces this in chunk 3c.
const BUSY_RETRY_MS = 2_000
const BUSY_WAIT_MS = 5 * 60_000
const RECENT_LINES = 60
const RECENT_CHAT = 20

type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadVoiceRequest>>>

function publish(request: LoadedRequest, state: VoiceRequestState | null) {
  if (state && request.threadRootId) {
    notifyVoiceRequest(request.threadRootId, state)
  }
}

// Null when the call's previous request is still running past the wait, or
// this one was cancelled while waiting.
async function createVoiceRun(request: LoadedRequest) {
  const deadline = Date.now() + BUSY_WAIT_MS
  while (Date.now() < deadline) {
    const run = await db
      .insert(schema.agentRun)
      .values({
        workspaceId: request.workspaceId,
        channelId: request.channelId,
        scopeKey: request.sessionId,
        budgetSteps: env.AGENT_RUN_MAX_STEPS,
        budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
        budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
        budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
        budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
        budgetWallMs: Math.min(env.AGENT_RUN_MAX_WALL_MS, VOICE_RUN_WALL_MS),
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((rows) => rows[0] ?? null)
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) return null
        throw err
      })
    if (run) return run.id
    await sleep(BUSY_RETRY_MS)
    const current = await loadVoiceRequest(request.id)
    if (current?.status !== "queued") return null
  }
  return null
}

// The call so far as background: transcript lines by speaker and the call
// chat, in time order. The request itself is the turn Lor answers.
async function loadCallBackground(
  request: LoadedRequest
): Promise<ConversationTurn[]> {
  const startedAt = request.sessionStartedAt.getTime()
  const [lines, chat] = await Promise.all([
    listRecentCallLines(request.sessionId, {
      untilMs: request.startMs,
      limit: RECENT_LINES,
    }),
    request.threadRootId
      ? db
          .select({
            content: schema.message.content,
            createdAt: schema.message.createdAt,
            authorName: schema.user.name,
          })
          .from(schema.message)
          .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
          .where(eq(schema.message.threadRootId, request.threadRootId))
          .orderBy(desc(schema.message.createdAt))
          .limit(RECENT_CHAT)
      : [],
  ])
  const turns = [
    ...lines.map((line) => ({
      at: startedAt + line.startMs,
      turn: { authorName: line.speakerName, content: line.text },
    })),
    ...chat.flatMap((message) =>
      message.content
        ? [
            {
              at: message.createdAt.getTime(),
              turn: {
                authorName: message.authorName,
                content: `[call chat] ${message.content}`,
              },
            },
          ]
        : []
    ),
  ]
  return turns.sort((a, b) => a.at - b.at).map((entry) => entry.turn)
}

async function runVoiceRequest(request: LoadedRequest, runId: string) {
  const claim = await claimAgentRun(runId)
  if (claim.kind === "terminal") return
  if (claim.kind !== "claimed") {
    publish(request, await finishVoiceRequest(request.id, { status: "failed" }))
    return
  }
  const execution = claim.execution
  const writer = execution.writer
  writer.append({ kind: "state", state: "working" })

  try {
    const gate = await checkCredits(execution.workspaceId)
    if (!gate.allowed) {
      await writer.transition("failed", { stopReason: "out_of_credits" })
      await writer.close()
      publish(
        request,
        await finishVoiceRequest(request.id, { status: "failed" })
      )
      return
    }

    const answer = await respond(
      {
        workspaceId: execution.workspaceId,
        conversation: execution.resume
          ? execution.resume.conversation
          : [{ authorName: request.speakerName, content: request.heardText }],
        ...(execution.resume
          ? {}
          : { backgroundConversation: await loadCallBackground(request) }),
        channelId: request.channelId,
        runId,
        voice: {
          speakerName: request.speakerName,
          show: async (blocks) => {
            publish(
              request,
              await setVoiceRequestResult(request.id, { blocks })
            )
          },
        },
      },
      {
        onDelta: () => {},
        onUsage: (usage) => {
          if (
            usage.tool === "investigate_code" ||
            usage.tool === "propose_code_change" ||
            usage.tool === "create_artifacts"
          ) {
            execution.noteNestedUsage(usage)
          }
          void recordUsage(usage, { channelId: request.channelId })
        },
        notifyWorkspaceActivity,
      },
      // Steering for voice requests arrives in chunk 3c.
      { ...execution.handle, drainConversation: undefined }
    )

    const stopped = answer.stoppedFor === "stopped_by_user"
    await writer.transition(stopped ? "stopped" : "complete", {
      stopReason: answer.stoppedFor ?? "completed",
    })
    execution.stop()
    await writer.close()
    // The final reply becomes the answer when Lor never called show_in_call.
    // Nothing at all to show (e.g. a budget stop) is a failure. A cancel
    // already settled the request, so the update below no-ops then.
    const reply = answer.text.trim()
    const shown = (await loadVoiceRequest(request.id))?.result
    publish(
      request,
      await finishVoiceRequest(request.id, {
        status: shown || reply ? "done" : "failed",
        ...(reply
          ? { fallback: { blocks: [{ type: "answer", markdown: reply }] } }
          : {}),
      })
    )
  } catch (err) {
    if (err instanceof LeaseLostError || execution.aborted()) {
      logger.warn({ err, runId }, "Voice run superseded; exiting silently")
      return
    }
    logger.error({ err, runId }, "Voice run failed")
    await writer.transition("failed", { stopReason: "error" })
    await writer.close()
    publish(request, await finishVoiceRequest(request.id, { status: "failed" }))
  } finally {
    execution.stop()
  }
}

// Runs a request someone spoke to Lor in a call. A retried job (worker crash)
// finds the request working and resumes its run from the last checkpoint.
export function createVoiceRequestProcessor() {
  return async (job: Job<VoiceRequestJobData>) => {
    const request = await loadVoiceRequest(job.data.requestId)
    if (!request) return
    if (request.status === "working" && request.runId) {
      await runVoiceRequest(request, request.runId)
      return
    }
    if (request.status !== "queued") return

    const runId = await createVoiceRun(request)
    if (!runId) {
      publish(
        request,
        await finishVoiceRequest(request.id, { status: "failed" })
      )
      return
    }
    const started = await startVoiceRequest(request.id, runId)
    if (!started) {
      // Cancelled between the run insert and the start.
      await cancelPendingRun(runId)
      return
    }
    publish(request, started)
    notifyWorkspaceActivity(request.workspaceId)
    await runVoiceRequest(request, runId)
  }
}
