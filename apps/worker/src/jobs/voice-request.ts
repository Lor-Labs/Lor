import { setTimeout as sleep } from "node:timers/promises"
import { checkCredits, recordUsage } from "@repo/billing"
import { db, desc, eq, isUniqueViolation, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { type ConversationTurn, respond, voiceBlocksText } from "@repo/lor"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import type { VoiceRequestJobData } from "@repo/realtime-types/queues"
import {
  claimQueuedVoiceRequests,
  finishRunVoiceRequests,
  finishVoiceRequest,
  listRecentCallLines,
  listShownVoiceRequests,
  loadVoiceRequest,
  notifyVoiceRequest,
  notifyVoiceRequestActivity,
  notifyVoiceRequestReaction,
  runVoiceResultShown,
  setRunVoiceResult,
  startVoiceRequest,
} from "@repo/voice/server"
import type { Job } from "bullmq"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import { logger } from "@/lib/logger"
import { cancelPendingRun } from "@/lib/unattended-run"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// A request in a call is bounded to the call, not the 2h default.
const VOICE_RUN_WALL_MS = 10 * 60_000
// One run per call at a time (scopeKey = session). A request made while a
// run works is claimed by that run at its next step (steering); one that
// arrives as the run ends gets its own run once the scope is free.
const BUSY_RETRY_MS = 1_000
const BUSY_WAIT_MS = 5 * 60_000
const RECENT_LINES = 60
const RECENT_CHAT = 20
const SHOWN_RESULTS = 5
const WINDOW_TOOLS = new Set(["show_in_call", "react_in_call"])

type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadVoiceRequest>>>

function publish(request: LoadedRequest, state: VoiceRequestState | null) {
  if (state && request.threadRootId) {
    notifyVoiceRequest(request.threadRootId, state)
  }
}

// What Lor hears for a request; a clicked choice reads as one.
function requestText(gate: LoadedRequest["gate"], heardText: string) {
  return gate === "choice" ? `(picked in Lor's window) ${heardText}` : heardText
}

async function createVoiceRun(
  request: LoadedRequest
): Promise<{ runId: string } | "absorbed" | "gone" | "timeout"> {
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
    if (run) return { runId: run.id }
    await sleep(BUSY_RETRY_MS)
    const current = await loadVoiceRequest(request.id)
    // The running request took this one on at its next step.
    if (current?.status === "working") return "absorbed"
    if (current?.status !== "queued") return "gone"
  }
  return "timeout"
}

// The call so far as background, in time order: transcript lines by
// speaker, the call chat, and what Lor showed for earlier requests. The
// request itself is the turn Lor answers.
async function loadCallBackground(
  request: LoadedRequest
): Promise<ConversationTurn[]> {
  const startedAt = request.sessionStartedAt.getTime()
  const [lines, chat, shown] = await Promise.all([
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
    listShownVoiceRequests(request.sessionId, {
      before: new Date(request.createdAt),
      limit: SHOWN_RESULTS,
    }),
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
    ...shown.flatMap((entry) =>
      entry.result
        ? [
            {
              at: entry.createdAt.getTime(),
              turn: {
                authorName: "Lor",
                content: `[shown in Lor's window for ${entry.speakerName}: "${entry.heardText}"]\n${voiceBlocksText(entry.result.blocks)}`,
              },
            },
          ]
        : []
    ),
  ]
  return turns.sort((a, b) => a.at - b.at).map((entry) => entry.turn)
}

async function failRun(request: LoadedRequest, runId: string) {
  for (const state of await finishRunVoiceRequests(runId, {
    status: "failed",
  })) {
    publish(request, state)
  }
}

async function runVoiceRequest(request: LoadedRequest, runId: string) {
  const claim = await claimAgentRun(runId)
  if (claim.kind === "terminal") return
  if (claim.kind !== "claimed") {
    await failRun(request, runId)
    return
  }
  const execution = claim.execution
  const writer = execution.writer
  writer.append({ kind: "state", state: "working" })
  const startedTools = new Set<string>()
  // The request on stage: tools and reactions show on it.
  let stageRequestId = request.id

  try {
    const gate = await checkCredits(execution.workspaceId)
    if (!gate.allowed) {
      await writer.transition("failed", { stopReason: "out_of_credits" })
      await writer.close()
      await failRun(request, runId)
      return
    }

    const answer = await respond(
      {
        workspaceId: execution.workspaceId,
        conversation: execution.resume
          ? execution.resume.conversation
          : [
              {
                authorName: request.speakerName,
                content: requestText(request.gate, request.heardText),
              },
            ],
        ...(execution.resume
          ? {}
          : { backgroundConversation: await loadCallBackground(request) }),
        channelId: request.channelId,
        runId,
        voice: {
          speakerName: request.speakerName,
          show: async (blocks) => {
            publish(request, await setRunVoiceResult(runId, { blocks }))
          },
          react: async (emoji) => {
            if (!request.threadRootId) return
            notifyVoiceRequestReaction(request.threadRootId, {
              sessionId: request.sessionId,
              requestId: stageRequestId,
              emoji,
            })
          },
        },
      },
      {
        onDelta: () => {},
        // Lor's window shows which tools are in use; its own window tools
        // aren't work worth showing.
        onToolEvent: (event) => {
          const { toolName } = event
          if (
            !toolName ||
            !request.threadRootId ||
            WINDOW_TOOLS.has(toolName) ||
            startedTools.has(event.toolCallId)
          ) {
            return
          }
          startedTools.add(event.toolCallId)
          notifyVoiceRequestActivity(request.threadRootId, {
            sessionId: request.sessionId,
            requestId: stageRequestId,
            toolName,
          })
        },
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
      {
        ...execution.handle,
        // Steering: requests made in the call since the last step.
        drainConversation: async () => {
          const claimed = await claimQueuedVoiceRequests(
            request.sessionId,
            runId
          )
          for (const entry of claimed) publish(request, entry.request)
          const newest = claimed.at(-1)
          if (newest) stageRequestId = newest.request.id
          return {
            steered: claimed.map((entry) => ({
              messageId: entry.request.id,
              authorName: entry.speakerName,
              content: requestText(entry.gate, entry.request.heardText),
            })),
            ambient: [],
          }
        },
      }
    )

    const stopped = answer.stoppedFor === "stopped_by_user"
    await writer.transition(stopped ? "stopped" : "complete", {
      stopReason: answer.stoppedFor ?? "completed",
    })
    execution.stop()
    await writer.close()
    // A cancel stops the whole run, so every request it took on ends
    // cancelled. Otherwise the final reply becomes the answer when Lor never
    // called show_in_call, and nothing at all to show (e.g. a budget stop)
    // is a failure.
    const reply = answer.text.trim()
    const shown = await runVoiceResultShown(runId)
    const finished = await finishRunVoiceRequests(
      runId,
      stopped
        ? { status: "cancelled" }
        : {
            status: shown || reply ? "done" : "failed",
            ...(reply
              ? { fallback: { blocks: [{ type: "answer", markdown: reply }] } }
              : {}),
          }
    )
    for (const state of finished) publish(request, state)
  } catch (err) {
    if (err instanceof LeaseLostError || execution.aborted()) {
      logger.warn({ err, runId }, "Voice run superseded; exiting silently")
      return
    }
    logger.error({ err, runId }, "Voice run failed")
    await writer.transition("failed", { stopReason: "error" })
    await writer.close()
    await failRun(request, runId)
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

    const created = await createVoiceRun(request)
    if (created === "absorbed" || created === "gone") return
    if (created === "timeout") {
      publish(
        request,
        await finishVoiceRequest(request.id, { status: "failed" })
      )
      return
    }
    const started = await startVoiceRequest(request.id, created.runId)
    if (!started) {
      // Cancelled, or claimed by a run that just started, before this one.
      await cancelPendingRun(created.runId)
      return
    }
    publish(request, started)
    notifyWorkspaceActivity(request.workspaceId)
    await runVoiceRequest(request, created.runId)
  }
}
