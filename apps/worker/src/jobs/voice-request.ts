import { setTimeout as sleep } from "node:timers/promises"
import { checkCredits, recordUsage } from "@repo/billing"
import { and, asc, db, desc, eq, isUniqueViolation, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  type ConversationTurn,
  pausedTurnExpired,
  respond,
  voiceBlocksText,
} from "@repo/lor"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import {
  VOICE_APPROVAL_WATCH_JOB,
  VOICE_SESSION_MEMORY_JOB,
  type VoiceApprovalWatchJobData,
  type VoiceRequestJobData,
  type VoiceSessionMemoryJobData,
} from "@repo/realtime-types/queues"
import {
  claimQueuedVoiceRequests,
  findRunVoiceRequest,
  finishRunVoiceRequests,
  finishVoiceRequest,
  listCallLines,
  listShownVoiceRequests,
  loadVoiceRequest,
  notifyVoiceRequest,
  notifyVoiceRequestActivity,
  notifyVoiceRequestReaction,
  parkRunVoiceRequests,
  resumeVoiceRequest,
  runVoiceResultShown,
  setRunVoiceResult,
  setVoiceRequestApprovers,
  startVoiceRequest,
} from "@repo/voice/server"
import type { Job } from "bullmq"
import { processCallMemory } from "@/jobs/voice-session-memory"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import { loadHarnessState, savedTurnText } from "@/lib/harness-state"
import { logger } from "@/lib/logger"
import type { LorMessageDeps } from "@/lib/lor-messages"
import { loadPausedDecisions } from "@/lib/paused-turn"
import { turnSandboxMode } from "@/lib/sandbox-mode"
import { cancelPendingRun } from "@/lib/unattended-run"
import {
  APPROVER_GRACE_MS,
  enqueueApprovalResume,
  expireApprovalSet,
  listCallApprovers,
  loadApproval,
  scheduleApprovalWatch,
  settleApprovalUnresolved,
} from "@/lib/voice-approvals"
import { buildVoiceDelta } from "@/lib/voice-continuation"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// A request in a call is bounded to the call, not the 2h default.
const VOICE_RUN_WALL_MS = 10 * 60_000
// One run per call at a time (scopeKey = session). A request made while a
// run works is claimed by that run at its next step (steering); one that
// arrives as the run ends gets its own run once the scope is free.
const BUSY_RETRY_MS = 1_000
const BUSY_WAIT_MS = 5 * 60_000
// Runaway guards: the whole call goes in, so a reference to something said
// long ago still lands.
const MAX_CALL_LINES = 5_000
const MAX_CALL_CHAT = 1_000
const SHOWN_RESULTS = 20
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
    if (request.status === "queued" && current?.status === "working") {
      return "absorbed"
    }
    if (current?.status !== request.status) return "gone"
  }
  return "timeout"
}

// The call so far as background, in time order: the whole transcript by
// speaker, the call chat, and what Lor showed for earlier requests. The
// request itself is the turn Lor answers. Only the call's first run (or one
// that can't continue the last) builds this.
async function loadCallBackground(
  request: LoadedRequest
): Promise<ConversationTurn[]> {
  const startedAt = request.sessionStartedAt.getTime()
  const [lines, chat, shown] = await Promise.all([
    listCallLines(request.sessionId, {
      untilMs: request.startMs,
      limit: MAX_CALL_LINES,
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
          .limit(MAX_CALL_CHAT)
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

// `resume`: the run finishes a turn paused on approvals whose set is now
// decided.
async function runVoiceRequest(
  request: LoadedRequest,
  runId: string,
  resume = false
) {
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

    const turn = {
      authorName: request.speakerName,
      content: requestText(request.gate, request.heardText),
    }
    // One Pi conversation per call (pi-harness-runbook.md §4.10).
    const owner = { voiceSessionId: request.sessionId }
    const harnessState = await loadHarnessState(owner, execution.workspaceId)
    // The lost attempt saved its turn before it died: deliver that answer.
    const savedAnswer =
      execution.resume && harnessState?.lastRunId === runId
        ? await savedTurnText(runId)
        : null
    // Another adapter version saved the paused turn: it is dropped.
    const upgraded = harnessState ? pausedTurnExpired(harnessState) : false
    const continueOnly =
      resume && Boolean(harnessState?.continuation) && !upgraded
    // After the call's first turn, the prompt is only what was said since.
    const delta =
      execution.resume || continueOnly || !harnessState
        ? null
        : await buildVoiceDelta(
            { ...request, speakerName: turn.authorName, content: turn.content },
            harnessState.lastRunId
          )
    if (delta && harnessState?.lastRunId) {
      await execution.markContinuedFrom(harnessState.lastRunId)
    }
    // A paused turn finishes first, or is dropped; a new request rejects
    // what is pending.
    const paused =
      savedAnswer === null &&
      harnessState?.continuation &&
      harnessState.lastRunId
        ? await loadPausedDecisions(
            harnessState.lastRunId,
            continueOnly
              ? null
              : { userId: request.userId, name: request.speakerName },
            upgraded
          )
        : null
    // The request that waited on them ends; this run takes over the turn.
    if (paused?.closed.length && harnessState?.lastRunId) {
      const waiting = await findRunVoiceRequest(harnessState.lastRunId)
      if (waiting?.status === "awaiting_approval") {
        publish(
          request,
          await finishVoiceRequest(waiting.id, { status: "done" })
        )
      }
    }
    // The speaker's mode (pi-harness-runbook.md §4.6).
    const sandboxMode = await turnSandboxMode({
      saved: execution.resume?.context.sandboxMode,
      paused: continueOnly ? paused?.sandboxMode : undefined,
      automated: false,
      userId: request.userId,
    })

    const answer = await respond(
      {
        workspaceId: execution.workspaceId,
        conversation: execution.resume
          ? execution.resume.conversation
          : continueOnly
            ? []
            : [turn],
        ...(execution.resume || delta || continueOnly
          ? {}
          : {
              backgroundConversation: await loadCallBackground(request),
            }),
        ...(delta ? { delta: { text: delta, coveredMessageIds: [] } } : {}),
        channelId: request.channelId,
        runId,
        voice: {
          canApprove: async (target) =>
            (await listCallApprovers(request, target)).length > 0,
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
            usage.tool === "propose_code_change"
          ) {
            execution.noteNestedUsage(usage)
          }
          void recordUsage(usage, { channelId: request.channelId })
        },
        notifyWorkspaceActivity,
      },
      {
        ...execution.handle,
        harness: {
          owner,
          saved: harnessState,
          savedAnswer,
          pausedDecisions: paused && !paused.dropped ? paused.decisions : null,
          pausedDropped: paused?.dropped ?? null,
          continueOnly,
          sandboxMode,
          pausedSandboxContext: paused?.sandboxContext,
          pausedSandboxMode: paused?.sandboxMode,
          saveTurn: (record) => execution.saveTurn(owner, record),
        },
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
    if (answer.stoppedFor === "awaiting_approval") {
      await parkRun(request, runId)
      return
    }
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

// The paused set's next pending approval, in set order, as Lor's window
// shows it. Null when none is left.
async function nextVoiceApproval(request: LoadedRequest, runId: string) {
  const [approval] = await db
    .select({
      id: schema.approval.id,
      description: schema.approval.description,
      toolName: schema.approval.toolName,
      target: schema.approval.target,
    })
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.runId, runId),
        eq(schema.approval.status, "pending")
      )
    )
    .orderBy(asc(schema.approval.createdAt), asc(schema.approval.id))
    .limit(1)
  if (!approval) return null
  return {
    approvalId: approval.id,
    label: approval.description,
    toolName: approval.toolName ?? "",
    approvers: await listCallApprovers(request, approval.target),
  }
}

// The run paused on approvals (only ones someone in the call can resolve:
// canApprove refuses the rest). Its request waits in Lor's window on one
// approval of the set at a time, and a watcher keeps the approvers current.
async function parkRun(request: LoadedRequest, runId: string) {
  const approval = await nextVoiceApproval(request, runId)
  if (!approval) {
    await failRun(request, runId)
    return
  }
  const parked = await parkRunVoiceRequests(runId, approval)
  for (const state of parked) publish(request, state)
  const waiting = parked.find((state) => state.status === "awaiting_approval")
  if (waiting) {
    await scheduleApprovalWatch({
      requestId: waiting.id,
      approvalId: approval.approvalId,
      missingSince: null,
    })
  }
}

// A decision left more of the set pending: Lor's window shows the next one.
async function showNextApproval(
  request: LoadedRequest,
  runId: string
): Promise<boolean> {
  const approval = await nextVoiceApproval(request, runId)
  if (!approval) return false
  publish(request, await setVoiceRequestApprovers(request.id, approval))
  await scheduleApprovalWatch({
    requestId: request.id,
    approvalId: approval.approvalId,
    missingSince: null,
  })
  return true
}

// Keeps a paused request's approvers current. When none is left in the call
// for the grace period the approval is rejected and the request moves on
// (the next approval, or Lor says so); when the call ended the whole set
// expires and the request fails.
async function watchApproval(data: VoiceApprovalWatchJobData) {
  const request = await loadVoiceRequest(data.requestId)
  if (
    request?.status !== "awaiting_approval" ||
    request.approval?.approvalId !== data.approvalId
  ) {
    return
  }
  const approval = await loadApproval(data.approvalId)
  if (approval?.status !== "pending") return
  if (request.sessionEndedAt) {
    if (request.runId) await expireApprovalSet(request.runId)
    publish(request, await finishVoiceRequest(request.id, { status: "failed" }))
    return
  }

  const approvers = await listCallApprovers(request, approval.target)
  const ids = (list: { userId: string }[]) =>
    list.map((approver) => approver.userId).join()
  if (ids(approvers) !== ids(request.approval.approvers)) {
    publish(
      request,
      await setVoiceRequestApprovers(request.id, {
        ...request.approval,
        approvers,
      })
    )
  }
  const now = Date.now()
  const missingSince = approvers.length > 0 ? null : (data.missingSince ?? now)
  if (missingSince !== null && now - missingSince >= APPROVER_GRACE_MS) {
    if (await settleApprovalUnresolved(data.approvalId, "rejected")) {
      await enqueueApprovalResume(request.id, data.approvalId)
    }
    return
  }
  await scheduleApprovalWatch({ ...data, missingSince })
}

// After a decision on a paused request: the set's next approval, or, once
// all are decided, a new run finishes the paused turn
// (pi-harness-runbook.md §4.2).
async function resumeRequest(request: LoadedRequest) {
  if (request.status !== "awaiting_approval") return
  if (request.runId && (await showNextApproval(request, request.runId))) {
    return
  }
  const created = await createVoiceRun(request)
  if (created === "timeout") {
    publish(request, await finishVoiceRequest(request.id, { status: "failed" }))
    return
  }
  if (typeof created === "string") return
  const resumed = await resumeVoiceRequest(request.id, created.runId)
  if (!resumed) {
    await cancelPendingRun(created.runId)
    return
  }
  publish(request, resumed)
  await runVoiceRequest(request, created.runId, true)
}

// Runs a request someone spoke to Lor in a call. A retried job (worker crash)
// finds the request working and resumes its run from the last checkpoint.
// `deps` also tells everyone in a call that its summary is ready.
export function createVoiceRequestProcessor(deps: LorMessageDeps) {
  return async (
    job: Job<
      | VoiceRequestJobData
      | VoiceApprovalWatchJobData
      | VoiceSessionMemoryJobData
    >
  ) => {
    if (job.name === VOICE_APPROVAL_WATCH_JOB) {
      await watchApproval(job.data as VoiceApprovalWatchJobData)
      return
    }
    if (job.name === VOICE_SESSION_MEMORY_JOB) {
      await processCallMemory(
        (job.data as VoiceSessionMemoryJobData).sessionId,
        deps
      )
      return
    }
    const data = job.data as VoiceRequestJobData
    const request = await loadVoiceRequest(data.requestId)
    if (!request) return
    if (data.resumeApprovalId) {
      await resumeRequest(request)
      return
    }
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
