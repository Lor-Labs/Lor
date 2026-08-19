import { randomUUID } from "node:crypto"
import { checkCredits, recordUsage } from "@repo/billing"
import {
  and,
  db,
  eq,
  inArray,
  isUniqueViolation,
  MERLIN_USER_ID,
  schema,
} from "@repo/db"
import { env } from "@repo/env/server"
import { respond, writeBack } from "@repo/merlin"
import {
  actRunBriefing,
  flushActWindow,
  saveHandoffNote,
} from "@repo/merlin/act-runs"
import {
  buildMessageFanout,
  sendInstructionsProposalPush,
  sendMessagePushNotifications,
} from "@repo/messaging"
import type { RealtimeMessage } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  ActFlushJobData,
  MerlinRespondJobData,
  TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { ACT_FLUSH_JOB } from "@repo/realtime-types/queues"
import {
  channelRoom,
  threadRoom,
  userRoom,
  workspaceRoom,
} from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { claimAgentRun, LeaseLostError } from "@/lib/agent-run"
import { logger } from "@/lib/logger"

type RedisClient = ReturnType<typeof createClient>

// Same write-back guardrails as merlin-respond: never endanger the delivered
// outcome, and serialize brain writes per workspace.
const WRITEBACK_LOCK_TTL = 120
const WRITEBACK_MIN_BUDGET_FRACTION = 0.15
const WRITEBACK_MIN_CREDITS = 50

async function loadMerlinAuthor() {
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, MERLIN_USER_ID))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function loadChannel(channelId: string) {
  return db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
      workspaceName: schema.workspace.name,
    })
    .from(schema.channel)
    .leftJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.channel.workspaceId)
    )
    .where(eq(schema.channel.id, channelId))
    .then((rows) => rows[0] ?? null)
}

// Headless triggered runs — the Act effect. No placeholder message, no
// streaming: Merlin gets the trigger's instructions + the event payload and
// decides the disposition via tools (post_channel_message / create_task /
// nothing). The final answer text is discarded; the run row + transcript are
// the audit trail. See reference/automation-primitives.md §2.
export function createTriggeredRunProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<MerlinRespondJobData>,
  // Own queue: a batch waiting on an in-flight run re-arms its flush.
  triggeredQueue: Queue<TriggeredRunJobData | ActFlushJobData>
) {
  // Post a channel message as Merlin, with normal unread/mention/push fanout —
  // the worker-side counterpart of the API's postBotMessage.
  const postMerlinMessage = async (input: {
    channelId: string
    content: string
    type?: "default" | "task_card"
  }): Promise<{ messageId: string }> => {
    const [channel, author] = await Promise.all([
      loadChannel(input.channelId),
      loadMerlinAuthor(),
    ])
    if (!channel || !author) throw new Error("Channel or Merlin user missing")

    const inserted = await db
      .insert(schema.message)
      .values({
        channelId: input.channelId,
        authorId: MERLIN_USER_ID,
        content: input.content,
        type: input.type ?? "default",
      })
      .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
      .then((rows) => rows[0])
    if (!inserted) throw new Error("Message insert returned no row")

    let mentions: RealtimeMessage["mentions"] = []
    try {
      const fanout = await buildMessageFanout({
        authorId: MERLIN_USER_ID,
        channel,
        message: {
          id: inserted.id,
          content: input.content,
          author: { name: author.name, image: author.image },
          attachments: [],
        },
      })
      mentions = fanout.messageMentions
      for (const n of fanout.unreadNotifications) {
        emitter.to(userRoom(n.userId)).emit("notification:unread", n.payload)
      }
      for (const n of fanout.mentionNotifications) {
        emitter.to(userRoom(n.userId)).emit("notification:mention", n.payload)
      }
      void sendMessagePushNotifications({ fanout, redis }).catch((err) => {
        logger.error(
          { err, messageId: inserted.id },
          "Triggered post push failed"
        )
      })
    } catch (err) {
      logger.error(
        { err, messageId: inserted.id },
        "Triggered post fanout failed"
      )
    }

    const message: RealtimeMessage = {
      id: inserted.id,
      channelId: input.channelId,
      content: input.content,
      type: input.type ?? "default",
      pinned: false,
      createdAt: inserted.createdAt.toISOString(),
      author: { ...author, avatarColor: null },
      mentions,
      reactions: [],
      attachments: [],
      embeds: [],
      referencedMessage: null,
      threadRootId: null,
    }
    emitter.to(channelRoom(input.channelId)).emit("message:created", message)
    return { messageId: inserted.id }
  }

  // Card + task row + the task's first run — the same card-is-thread-root
  // shape as createTaskWithCard + the follow-up-run pattern in run-queue.ts,
  // so the created task lives entirely on existing task rails.
  const createMerlinTask = async (input: {
    workspaceId: string
    channelId: string
    title: string
    goal: string
  }): Promise<{ taskId: string }> => {
    const { messageId: cardId } = await postMerlinMessage({
      channelId: input.channelId,
      content: input.goal,
      type: "task_card",
    })
    const task = await db
      .insert(schema.task)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        cardMessageId: cardId,
        creatorId: MERLIN_USER_ID,
        title: input.title,
        goal: input.goal,
      })
      .returning({ id: schema.task.id })
      .then((rows) => rows[0] ?? null)
    if (!task) {
      await db
        .delete(schema.message)
        .where(eq(schema.message.id, cardId))
        .catch(() => {})
      throw new Error("Task insert returned no row")
    }

    const placeholder = await db
      .insert(schema.message)
      .values({
        channelId: input.channelId,
        authorId: MERLIN_USER_ID,
        threadRootId: cardId,
        status: "pending",
      })
      .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
      .then((rows) => rows[0] ?? null)
    if (!placeholder) return { taskId: task.id }

    const taskRun = await db
      .insert(schema.agentRun)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        messageId: placeholder.id,
        threadRootId: cardId,
        triggerMessageId: cardId,
        scopeKey: cardId,
        budgetSteps: env.AGENT_RUN_MAX_STEPS,
        budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
        budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
        budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
        budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
        budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((rows) => rows[0] ?? null)
      .catch((err) => {
        if (!isUniqueViolation(err)) {
          logger.error({ err, taskId: task.id }, "Task first-run insert failed")
        }
        return null
      })
    if (!taskRun) {
      await db
        .delete(schema.message)
        .where(eq(schema.message.id, placeholder.id))
        .catch(() => {})
      return { taskId: task.id }
    }

    const author = await loadMerlinAuthor()
    if (author) {
      emitter.to(threadRoom(cardId)).emit("message:created", {
        id: placeholder.id,
        channelId: input.channelId,
        content: null,
        type: "default",
        pinned: false,
        createdAt: placeholder.createdAt.toISOString(),
        author: { ...author, avatarColor: null },
        mentions: [],
        reactions: [],
        attachments: [],
        embeds: [],
        referencedMessage: null,
        threadRootId: cardId,
        status: "pending",
        streaming: true,
        merlinTriggerMessageId: cardId,
      })
    }

    try {
      await respondQueue.add(
        "respond",
        {
          merlinMessageId: placeholder.id,
          channelId: input.channelId,
          threadRootId: cardId,
          contextThreadRootId: cardId,
          triggerMessageId: cardId,
          runId: taskRun.id,
        },
        {
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
          jobId: taskRun.id,
        }
      )
    } catch (err) {
      logger.error({ err, taskId: task.id }, "Task first-run enqueue failed")
      await db
        .delete(schema.agentRun)
        .where(eq(schema.agentRun.id, taskRun.id))
        .catch(() => {})
      await db
        .delete(schema.message)
        .where(eq(schema.message.id, placeholder.id))
        .catch(() => {})
    }
    return { taskId: task.id }
  }

  return async (job: Job<TriggeredRunJobData | ActFlushJobData>) => {
    // Two shapes on one queue: a prepared run, or a window flush that turns
    // everything a burst delivered into a single run.
    let runId: string
    let payload: string
    let label: string
    if (job.name === ACT_FLUSH_JOB) {
      const { triggerId } = job.data as ActFlushJobData
      const flushed = await flushActWindow(triggerId)
      if (flushed.kind === "retry") {
        await triggeredQueue.add(
          ACT_FLUSH_JOB,
          { triggerId },
          {
            delay: flushed.delayMs,
            attempts: 2,
            backoff: { type: "fixed", delay: 5000 },
            removeOnComplete: true,
          }
        )
        return
      }
      if (flushed.kind === "skip") {
        logger.info({ triggerId, reason: flushed.reason }, "Act flush skipped")
        return
      }
      // Deliveries that landed while this batch was being claimed get their own
      // flush — enqueued before the run executes so it can't be lost with it.
      if (flushed.rearmDelayMs !== undefined) {
        await triggeredQueue
          .add(
            ACT_FLUSH_JOB,
            { triggerId },
            {
              delay: flushed.rearmDelayMs,
              attempts: 2,
              backoff: { type: "fixed", delay: 5000 },
              removeOnComplete: true,
            }
          )
          .catch((err) =>
            logger.error({ err, triggerId }, "Act straggler re-arm failed")
          )
      }
      ;({ runId, payload, label } = flushed.run)
    } else {
      ;({ runId, payload, label } = job.data as TriggeredRunJobData)
    }

    const run = await db
      .select({
        id: schema.agentRun.id,
        workspaceId: schema.agentRun.workspaceId,
        channelId: schema.agentRun.channelId,
        triggerId: schema.agentRun.triggerId,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .then((rows) => rows[0])
    if (!run?.triggerId) {
      logger.error({ runId }, "Triggered job without a run/trigger; skipping")
      return
    }

    // Kill switch, re-read at process time: disabling the trigger (or
    // clearing its instructions) between ack and execution cancels the run.
    const trigger = await db
      .select({
        enabled: schema.connectorTrigger.enabled,
        actInstructions: schema.connectorTrigger.actInstructions,
      })
      .from(schema.connectorTrigger)
      .where(eq(schema.connectorTrigger.id, run.triggerId))
      .then((rows) => rows[0])
    if (!trigger?.enabled || trigger.actInstructions === null) {
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
      logger.info({ runId }, "Triggered run cancelled; trigger disabled")
      return
    }

    const claim = await claimAgentRun(runId)
    if (claim.kind === "terminal") return
    if (claim.kind === "legacy") {
      // Triggered jobs always have a run row — reaching here is a bug.
      logger.error({ runId }, "Triggered run row unreadable; skipping")
      return
    }
    if (claim.kind === "exhausted") {
      logger.warn({ runId }, "Triggered run out of recovery attempts")
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
          "Triggered run refused; workspace out of credits"
        )
        await runWriter.transition("failed", { stopReason: "out_of_credits" })
        emitter
          .to(workspaceRoom(execution.workspaceId))
          .emit("billing:updated", {
            workspaceId: execution.workspaceId,
            reason: "out_of_credits",
          })
        await runWriter.close()
        return
      }

      // Recovery resumes from the persisted snapshot; fresh runs get the
      // payload as the single user turn.
      const conversation = execution.resume
        ? execution.resume.conversation
        : [{ authorName: label, content: payload }]

      const usageRefs = { channelId: run.channelId }
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

      // What earlier runs on this trigger concluded, and what people said in
      // the channel since. Best-effort: a briefing failure must not cost the
      // run.
      const briefing = await actRunBriefing({
        triggerId: run.triggerId,
        channelId: run.channelId,
        runId,
      }).catch((err) => {
        logger.warn({ err, runId }, "Act briefing failed; running without it")
        return null
      })

      const answer = await respond(
        {
          workspaceId: execution.workspaceId,
          conversation,
          channelId: run.channelId,
          runId,
          triggered: {
            label,
            instructions: trigger.actInstructions,
            briefing,
            postMessage: (content) =>
              postMerlinMessage({ channelId: run.channelId, content }),
            createTask: ({ title, goal }) =>
              createMerlinTask({
                workspaceId: execution.workspaceId,
                channelId: run.channelId,
                title,
                goal,
              }),
          },
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
                "Triggered run tool returned an error"
              )
            }
          },
          onUsage: (u) => {
            logger.info({ ...u }, "Triggered run usage")
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
      // The closing text is this run's handoff note — persisted before anything
      // else can fail, since the next run's briefing depends on it.
      await saveHandoffNote(runId, answer.text)
      await runWriter.transition(stoppedByUser ? "stopped" : "complete", {
        stopReason: answer.stoppedFor ?? "completed",
      })
      execution.stop()
      logger.info(
        { runId, stopReason: answer.stoppedFor ?? "completed" },
        "Triggered run complete"
      )
      if (stoppedByUser) {
        await runWriter.close()
        return
      }

      // Write-back: webhook payloads can carry durable facts (call
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
          "Triggered write-back skipped; run finished near a budget ceiling"
        )
        await runWriter.close()
        return
      }
      await execution.setPhase("writeback")

      const lockKey = `merlin:writeback:${execution.workspaceId}`
      const lockToken = randomUUID()
      const acquired = await redis
        .set(lockKey, lockToken, { NX: true, EX: WRITEBACK_LOCK_TTL })
        .catch(() => null)
      if (acquired !== "OK") {
        logger.info(
          { runId, workspaceId: execution.workspaceId },
          "Triggered write-back skipped; another is in progress"
        )
        await runWriter.close()
        return
      }
      try {
        await writeBack(
          {
            workspaceId: execution.workspaceId,
            priorMessages: answer.messages,
            gateText: `${label}: ${conversation
              .map((t) => t.content)
              .join("\n")}\n\nMerlin: ${answer.text}`,
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
        logger.error({ err, runId }, "Triggered write-back failed")
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
          "Triggered attempt superseded mid-run; exiting silently"
        )
        return
      }
      logger.error({ err, runId }, "Triggered run failed")
      await runWriter.transition("failed", {
        stopReason:
          Date.now() >= execution.handle.budgets.deadlineAt.getTime()
            ? "budget_wall_clock"
            : "error",
      })
      await runWriter.close()
    } finally {
      execution.stop()
    }
  }
}
