import { randomUUID } from "node:crypto"
import { checkCredits, recordUsage } from "@repo/billing"
import { and, db, eq, inArray, schema } from "@repo/db"
import { type RunTriggeredContext, respond, writeBack } from "@repo/lor"
import { saveHandoffNote } from "@repo/lor/act-runs"
import { sendInstructionsProposalPush } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { workspaceRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import { logger } from "@/lib/logger"

type RedisClient = ReturnType<typeof createClient>

// Same write-back guardrails as lor-respond: never endanger the delivered
// outcome, and serialize brain writes per workspace.
const WRITEBACK_LOCK_TTL = 120
const WRITEBACK_MIN_BUDGET_FRACTION = 0.15
const WRITEBACK_MIN_CREDITS = 50

export type UnattendedRunDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

// Terminal outcome of an unattended run, reported to onSettled exactly once.
// Recovery re-attempts (lost lease / superseded) never settle — the run isn't
// over, another attempt owns it.
export type UnattendedSettlement = {
  outcome: "complete" | "failed" | "stopped"
  stopReason: string
}

export type UnattendedRunParams = {
  runId: string
  channelId: string
  // Event/schedule source label — the conversation turn's author name and the
  // write-back gate prefix.
  label: string
  // The single user turn for a fresh run (recovery resumes from the snapshot).
  payload: string
  // Prompt inputs + disposition executors, composed by the caller AFTER its
  // kill switch passed. Briefing is injected separately (see composeBriefing).
  triggered: Omit<RunTriggeredContext, "briefing">
  // Best-effort, computed post-claim so terminal retries don't pay for it; a
  // failure must not cost the run.
  composeBriefing?: () => Promise<string | null>
  // Persistent-sandbox scope override (loops pass loop.id).
  sandboxKey?: string
  // Log/marker prefix: "Triggered" (Act) or "Loop".
  kind: string
  onSettled?: (settlement: UnattendedSettlement) => Promise<void>
}

// The queued run was cancelled before execution (kill switch: trigger
// disabled, loop paused). Terminal states are never clobbered.
export async function cancelPendingRun(runId: string): Promise<void> {
  await db
    .update(schema.agentRun)
    .set({
      state: "stopped",
      stopReason: "stopped_by_user",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentRun.id, runId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .catch(() => {})
}

// The shared body of every headless (unattended) run — Act triggers and
// loops: claim → credits gate → respond() with the triggered context →
// handoff note → terminal transition → memory write-back. No placeholder
// message, no streaming; the run row + transcript are the audit trail.
// Callers own job parsing, the kill switch, and context composition.
// See reference/automation-primitives.md §2 and reference/loops.md.
export async function runUnattended(
  deps: UnattendedRunDeps,
  params: UnattendedRunParams
): Promise<void> {
  const { emitter, redis } = deps
  const { runId, kind } = params

  const settle = async (settlement: UnattendedSettlement) => {
    if (!params.onSettled) return
    await params.onSettled(settlement).catch((err) => {
      logger.error({ err, runId }, `${kind} run settlement hook failed`)
    })
  }

  const claim = await claimAgentRun(runId)
  if (claim.kind === "terminal") return
  if (claim.kind === "legacy") {
    // Unattended jobs always have a run row — reaching here is a bug.
    logger.error({ runId }, `${kind} run row unreadable; skipping`)
    return
  }
  if (claim.kind === "exhausted") {
    // claimAgentRun already forced the row terminal (failed/error) — settle
    // so the caller's failure accounting (loop auto-pause) still sees it.
    logger.warn({ runId }, `${kind} run out of recovery attempts`)
    await settle({ outcome: "failed", stopReason: "error" })
    return
  }
  const execution = claim.execution
  const runWriter = execution.writer
  runWriter.append({ kind: "state", state: "working" })

  try {
    const gate = await checkCredits(execution.workspaceId)
    if (!gate.allowed) {
      logger.info(
        { runId, workspaceId: execution.workspaceId },
        `${kind} run refused; workspace out of credits`
      )
      await runWriter.transition("failed", { stopReason: "out_of_credits" })
      emitter.to(workspaceRoom(execution.workspaceId)).emit("billing:updated", {
        workspaceId: execution.workspaceId,
        reason: "out_of_credits",
      })
      await runWriter.close()
      await settle({ outcome: "failed", stopReason: "out_of_credits" })
      return
    }

    // Recovery resumes from the persisted snapshot; fresh runs get the
    // payload as the single user turn.
    const conversation = execution.resume
      ? execution.resume.conversation
      : [{ authorName: params.label, content: params.payload }]

    const usageRefs = { channelId: params.channelId }
    const notifyInstructionsProposal = (e: {
      version: number
      rationale: string
    }) => {
      emitter
        .to(workspaceRoom(execution.workspaceId))
        .emit("instructions:proposal", {
          workspaceId: execution.workspaceId,
          version: e.version,
        })
      return sendInstructionsProposalPush({
        workspaceId: execution.workspaceId,
        ...e,
      }).catch((err) =>
        logger.error(
          { err, workspaceId: execution.workspaceId },
          "Instructions proposal push failed"
        )
      )
    }

    // What earlier runs in this chain concluded, and what people said in the
    // channel since. Best-effort: a briefing failure must not cost the run.
    const briefing = params.composeBriefing
      ? await params.composeBriefing().catch((err) => {
          logger.warn(
            { err, runId },
            `${kind} briefing failed; running without it`
          )
          return null
        })
      : null

    const answer = await respond(
      {
        workspaceId: execution.workspaceId,
        conversation,
        channelId: params.channelId,
        runId,
        triggered: { ...params.triggered, briefing },
        ...(params.sandboxKey ? { sandboxKey: params.sandboxKey } : {}),
      },
      {
        // Headless: the answer text is discarded; nothing streams anywhere.
        onDelta: () => {},
        onMemoryWritten: (e) => {
          runWriter.append({ kind: "memory", ...e })
        },
        onToolEvent: (toolCall) => {
          if (toolCall.status === "error") {
            logger.warn(
              { runId, tool: toolCall.toolName },
              `${kind} run tool returned an error`
            )
          }
        },
        onUsage: (u) => {
          logger.info({ ...u }, `${kind} run usage`)
          if (
            u.tool === "investigate_code" ||
            u.tool === "propose_code_change" ||
            u.tool === "create_artifacts"
          )
            execution.noteNestedUsage(u)
          void recordUsage(u, usageRefs)
        },
        onInstructionsProposal: notifyInstructionsProposal,
      },
      // No steering surface exists for headless runs — drop the drain so
      // unrelated channel chatter is never injected mid-run.
      { ...execution.handle, drainConversation: undefined }
    )

    const stoppedByUser = answer.stoppedFor === "stopped_by_user"
    // The closing text is this run's handoff note — persisted before the
    // terminal transition so a crash in between can't lose it. Best effort
    // beyond that: the note only improves the next run's briefing, so a
    // failed save must not flip an otherwise-successful run (side effects
    // already landed) to failed via the outer catch.
    await saveHandoffNote(runId, answer.text).catch((err) =>
      logger.error({ err, runId }, `${kind} handoff note save failed`)
    )
    await runWriter.transition(stoppedByUser ? "stopped" : "complete", {
      stopReason: answer.stoppedFor ?? "completed",
    })
    execution.stop()
    logger.info(
      { runId, stopReason: answer.stoppedFor ?? "completed" },
      `${kind} run complete`
    )
    await settle(
      stoppedByUser
        ? { outcome: "stopped", stopReason: "stopped_by_user" }
        : { outcome: "complete", stopReason: answer.stoppedFor ?? "completed" }
    )
    if (stoppedByUser) {
      await runWriter.close()
      return
    }

    // Write-back: unattended payloads can carry durable facts (call
    // transcripts, decisions) — same memory pass, floors, and per-workspace
    // lock as conversational runs.
    const { budgets } = execution.handle
    const c = execution.counters()
    const inputLeft =
      (budgets.inputTokens - c.inputTokens) / budgets.inputTokens
    const outputLeft =
      (budgets.outputTokens - c.outputTokens) / budgets.outputTokens
    const creditsLeft = budgets.credits - c.creditsSpent
    const wallLeftMs = budgets.deadlineAt.getTime() - Date.now()
    if (
      inputLeft < WRITEBACK_MIN_BUDGET_FRACTION ||
      outputLeft < WRITEBACK_MIN_BUDGET_FRACTION ||
      creditsLeft < WRITEBACK_MIN_CREDITS ||
      wallLeftMs < 60_000
    ) {
      logger.info(
        { runId, counters: c },
        `${kind} write-back skipped; run finished near a budget ceiling`
      )
      await runWriter.close()
      return
    }
    await execution.setPhase("writeback")

    const lockKey = `lor:writeback:${execution.workspaceId}`
    const lockToken = randomUUID()
    const acquired = await redis
      .set(lockKey, lockToken, { NX: true, EX: WRITEBACK_LOCK_TTL })
      .catch(() => null)
    if (acquired !== "OK") {
      logger.info(
        { runId, workspaceId: execution.workspaceId },
        `${kind} write-back skipped; another is in progress`
      )
      await runWriter.close()
      return
    }
    try {
      await writeBack(
        {
          workspaceId: execution.workspaceId,
          channelId: params.channelId,
          priorMessages: answer.messages,
          gateText: `${params.label}: ${conversation
            .map((t) => t.content)
            .join("\n")}\n\nLor: ${answer.text}`,
        },
        {
          onMemoryWritten: (e) => {
            runWriter.append({ kind: "memory", ...e })
          },
          onUsage: (u) => {
            execution.addUsage(u)
            void recordUsage(u, usageRefs)
          },
          onInstructionsProposal: notifyInstructionsProposal,
        }
      )
    } catch (err) {
      logger.error({ err, runId }, `${kind} write-back failed`)
    } finally {
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [lockKey], arguments: [lockToken] }
        )
        .catch(() => {})
      await runWriter.close()
    }
  } catch (err) {
    if (err instanceof LeaseLostError || execution.aborted()) {
      logger.warn(
        { err, runId },
        `${kind} attempt superseded mid-run; exiting silently`
      )
      return
    }
    logger.error({ err, runId }, `${kind} run failed`)
    const stopReason =
      Date.now() >= execution.handle.budgets.deadlineAt.getTime()
        ? "budget_wall_clock"
        : "error"
    await runWriter.transition("failed", { stopReason })
    await runWriter.close()
    await settle({ outcome: "failed", stopReason })
  } finally {
    execution.stop()
  }
}
