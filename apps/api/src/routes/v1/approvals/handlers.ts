import { canResolveApproval } from "@repo/auth/permissions"
import {
  and,
  db,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  schema,
} from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { Approval, Plan } from "@repo/db/schema"
import { channelRoom } from "@repo/realtime-types/rooms"
import { findRunVoiceRequest } from "@repo/voice/server"
import {
  loadApprovalResolver,
  loadApprovalResolvers,
  serializeApproval,
} from "@/lib/approvals"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { resolveWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import {
  emitPlanUpdated,
  postScopeMessage,
  startScopeContinuationRun,
} from "@/lib/scope-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { enqueueVoiceRequest } from "@/lib/voice/runs"
import { findConnectedParticipant } from "@/lib/voice/sessions"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import type {
  ApproveApprovalRoute,
  ListChannelApprovalsRoute,
  RejectApprovalRoute,
} from "@/routes/v1/approvals/routes"

export const listChannelApprovals: AppRouteHandler<
  ListChannelApprovalsRoute
> = async (c) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const { threadRootId } = c.req.valid("query")

  const canAccess = await userCanAccessChannel(channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const rows = await db
    .select({
      approval: schema.approval,
      messageId: schema.agentRun.messageId,
      threadRootId: schema.agentRun.threadRootId,
      resolverUserName: schema.user.name,
    })
    .from(schema.approval)
    .innerJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
    .leftJoin(
      schema.approvalPolicy,
      and(
        eq(schema.approvalPolicy.workspaceId, schema.approval.workspaceId),
        eq(schema.approvalPolicy.target, schema.approval.target)
      )
    )
    .leftJoin(
      schema.user,
      eq(schema.approvalPolicy.resolverUserId, schema.user.id)
    )
    .where(
      and(
        eq(schema.agentRun.channelId, channelId),
        threadRootId
          ? and(
              eq(schema.agentRun.threadRootId, threadRootId),
              inArray(schema.approval.status, [
                "pending",
                "approved",
                "rejected",
              ])
            )
          : eq(schema.approval.status, "pending"),
        isNotNull(schema.approval.runId),
        // A call's approvals show only in the call (Lor's window).
        notExists(
          db
            .select({ id: schema.voiceRequest.id })
            .from(schema.voiceRequest)
            .where(eq(schema.voiceRequest.runId, schema.approval.runId))
        )
      )
    )
    .limit(50)

  const workspaceId = rows[0]?.approval.workspaceId
  const resolvers = workspaceId
    ? await loadApprovalResolvers(
        workspaceId,
        rows.map((r) => r.approval)
      )
    : new Map()

  return c.json(
    {
      approvals: rows.map((row) => {
        const resolver = resolvers.get(row.approval.id) ?? null
        return {
          ...serializeApproval(row.approval),
          channelId,
          threadRootId: row.threadRootId,
          messageId: row.messageId,
          resolver,
          // The joined name is only meaningful for a user resolver — never
          // surface a stale resolver_user_id's name for other kinds.
          resolverUserName:
            resolver?.kind === "user" ? row.resolverUserName : null,
        }
      }),
    },
    HttpStatusCodes.OK
  )
}

type ResolveOutcome =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "archived" }
  | { kind: "conflict" }
  | { kind: "post_failed" }
  | { kind: "resolved"; approval: Approval }

// The conversation an approval belongs to. A policy-gated approval takes it
// from the parked run; a plan's own request_approval predates the run pointer,
// so the plan's anchor thread is the fallback.
type ApprovalScope = {
  channelId: string
  threadRootId: string | null
  scopeKey: string
}

function approvalScope(
  run: {
    channelId: string
    threadRootId: string | null
    scopeKey: string
  } | null,
  plan: Plan | null
): ApprovalScope | null {
  if (run) {
    return {
      channelId: run.channelId,
      threadRootId: run.threadRootId,
      scopeKey: run.scopeKey,
    }
  }
  if (plan) {
    return {
      channelId: plan.channelId,
      threadRootId: plan.threadRootId,
      scopeKey: plan.threadRootId,
    }
  }
  return null
}

async function resolveApproval(
  approvalId: string,
  userId: string,
  resolution: "approved" | "rejected"
): Promise<ResolveOutcome> {
  const row = await db
    .select({
      approval: schema.approval,
      workspace: schema.workspace,
      run: {
        channelId: schema.agentRun.channelId,
        threadRootId: schema.agentRun.threadRootId,
        scopeKey: schema.agentRun.scopeKey,
        messageId: schema.agentRun.messageId,
      },
      plan: schema.plan,
    })
    .from(schema.approval)
    .innerJoin(
      schema.workspace,
      eq(schema.approval.workspaceId, schema.workspace.id)
    )
    .leftJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
    .leftJoin(schema.plan, eq(schema.approval.planId, schema.plan.id))
    .where(eq(schema.approval.id, approvalId))
    .limit(1)
    .then((rows) => rows[0])

  const scope = row ? approvalScope(row.run, row.plan) : null
  if (!row || !scope) return { kind: "not_found" }

  // An approval from a voice call resolves only from that call, by someone
  // connected to it, and resumes there.
  const voice = row.approval.runId
    ? await findRunVoiceRequest(row.approval.runId)
    : null
  if (voice) {
    if (voice.status !== "awaiting_approval" || voice.sessionEndedAt) {
      return { kind: "conflict" }
    }
    if (!(await findConnectedParticipant(voice.sessionId, userId))) {
      return { kind: "forbidden" }
    }
  }

  // Channel write access is the floor for every approval: someone who cannot
  // speak in the conversation can never authorize an action inside it.
  const access = await resolveChannelAccess(userId, scope.channelId)
  if (!access.ok) return { kind: "forbidden" }
  // Archived channel: the resolution message and continuation run can never
  // land, so refuse before the CAS instead of resolving into a stranded run.
  if (!access.access.canWrite) return { kind: "archived" }

  const member = await db
    .select()
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, row.approval.workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) return { kind: "forbidden" }

  const authority = await resolveWorkspaceAuthority(member, row.workspace)
  const spec = await loadApprovalResolver(
    row.approval.workspaceId,
    row.approval.target
  )
  const allowed = spec
    ? canResolveApproval(authority, spec, userId)
    : authority.isOwner
  if (!allowed) return { kind: "forbidden" }

  // CAS: only one resolver wins; a second click reads as already resolved.
  const resolved = await db
    .update(schema.approval)
    .set({
      status: resolution,
      resolvedBy: userId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(schema.approval.id, approvalId),
        eq(schema.approval.status, "pending")
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!resolved) return { kind: "conflict" }

  const undoResolution = () =>
    db
      .update(schema.approval)
      .set({ status: "pending", resolvedBy: null, resolvedAt: null })
      .where(
        and(
          eq(schema.approval.id, approvalId),
          eq(schema.approval.status, resolution),
          eq(schema.approval.resolvedBy, userId)
        )
      )
      .catch(() => {})

  // Nothing posts to the call chat: the paused request resumes in Lor's
  // window. Without the resume job the request would wait forever, so a
  // failed enqueue undoes the resolution for a retry.
  if (voice) {
    const queued = await enqueueVoiceRequest(voice.id, resolved.id)
      .then(() => true)
      .catch(() => false)
    if (!queued) {
      await undoResolution()
      return { kind: "post_failed" }
    }
    notifyWorkspaceActivity(resolved.workspaceId)
    return { kind: "resolved", approval: resolved }
  }

  // No message posts: the decision reaches Lor as the AI SDK's approval
  // response (or a decision line for request_approval), and the card shows
  // it. The continuation answers Lor's parked reply. Only an old message-less
  // run still needs a posted resolution to trigger on; if that can't be
  // created, un-resolve the CAS so the caller can retry.
  const messageId =
    row.run?.messageId ??
    (await postScopeMessage({
      channelId: scope.channelId,
      threadRootId: scope.threadRootId,
      authorId: userId,
      content:
        resolution === "approved"
          ? `Approved — go ahead: ${resolved.description}`
          : `Rejected — do not proceed: ${resolved.description}`,
    }).catch(() => null))
  if (!messageId) {
    await undoResolution()
    return { kind: "post_failed" }
  }
  // Acting in a thread (approving or rejecting) subscribes you to it.
  if (scope.threadRootId) {
    await subscribeToThread(scope.threadRootId, [userId]).catch(() => {})
  }

  // Pending approvals feed the sidebar aggregate directly, so any durable
  // resolution (approve or reject, plan or plan-less) changes it.
  notifyWorkspaceActivity(resolved.workspaceId)

  // Remaining side effects are best-effort: the continuation path self-heals
  // (an enqueue failure parks the plan back in waiting_for_input). Broadcasts
  // fail in isolation — a dead emitter must never block the continuation run.
  try {
    const io = await getEmitter()
    io.to(channelRoom(scope.channelId)).emit("approval:updated", {
      approvalId: resolved.id,
      channelId: scope.channelId,
      planId: resolved.planId,
      status: resolved.status,
      resolvedBy: resolved.resolvedBy,
      resolvedAt: resolved.resolvedAt
        ? resolved.resolvedAt.toISOString()
        : null,
    })
  } catch (err) {
    logger.warn(
      { err, approvalId },
      "Approval resolution broadcast failed; continuing"
    )
  }

  try {
    const plan = row.plan
    // Only a parked plan moves back to running, and only when the trigger
    // message exists — never resurrect a terminal plan (the continuation
    // run re-claims status itself if it does start).
    const updatedPlan = plan
      ? await db
          .update(schema.plan)
          .set({ status: "running" })
          .where(
            and(
              eq(schema.plan.id, plan.id),
              inArray(schema.plan.status, [
                "waiting_for_approval",
                "waiting_for_input",
              ])
            )
          )
          .returning()
          .then((rows) => rows[0] ?? null)
      : null
    if (updatedPlan) {
      await emitPlanUpdated(updatedPlan, { statusChanged: true }).catch(
        (err) => {
          logger.warn({ err, approvalId }, "Plan update broadcast failed")
        }
      )
    }

    await startScopeContinuationRun({
      workspaceId: resolved.workspaceId,
      channelId: scope.channelId,
      threadRootId: scope.threadRootId,
      scopeKey: scope.scopeKey,
      triggerMessageId: messageId,
      senderId: userId,
      // The worker replays a policy gate's parked tool call with the SDK
      // approval response, or hands request_approval its decision (unless an
      // old run's posted resolution already says it).
      ...(resolved.runId && (resolved.toolCallId || row.run?.messageId)
        ? { resumeApprovalId: resolved.id }
        : {}),
      ...(plan
        ? {
            onAbandoned: async () => {
              await db
                .update(schema.plan)
                .set({ status: "waiting_for_input" })
                .where(
                  and(
                    eq(schema.plan.id, plan.id),
                    eq(schema.plan.status, "running"),
                    // Same guard as startPlanContinuationRun: never park a
                    // plan a newer continuation already claimed.
                    isNull(schema.plan.activeRunId)
                  )
                )
                .returning()
                .then((rows) =>
                  rows[0]
                    ? emitPlanUpdated(rows[0], { statusChanged: true })
                    : undefined
                )
                .catch(() => {})
            },
          }
        : {}),
    })
  } catch (err) {
    logger.error(
      { err, approvalId, runId: resolved.runId },
      "Approval post-resolution side effects failed"
    )
  }

  return { kind: "resolved", approval: resolved }
}

// Approve and reject share identical route shapes; one handler body maps each
// ResolveOutcome to its response so new variants can't drift between the two.
function resolveHandler(resolution: "approved" | "rejected") {
  return async (c: Parameters<AppRouteHandler<ApproveApprovalRoute>>[0]) => {
    const outcome = await resolveApproval(
      c.req.valid("param").approvalId,
      c.var.user.id,
      resolution
    )
    switch (outcome.kind) {
      case "not_found":
        return c.json(
          { success: false as const, message: "Approval not found" },
          HttpStatusCodes.NOT_FOUND
        )
      case "forbidden":
        return c.json(
          { success: false as const, message: "Forbidden" },
          HttpStatusCodes.FORBIDDEN
        )
      case "archived":
        return c.json(
          { success: false as const, message: "Channel is archived" },
          HttpStatusCodes.BAD_REQUEST
        )
      case "conflict":
        return c.json(
          { success: false as const, message: "Already resolved" },
          HttpStatusCodes.CONFLICT
        )
      case "post_failed":
        return c.json(
          {
            success: false as const,
            message: "Failed to post approval resolution",
          },
          HttpStatusCodes.INTERNAL_SERVER_ERROR
        )
      case "resolved":
        return c.json(
          { approval: serializeApproval(outcome.approval) },
          HttpStatusCodes.OK
        )
    }
  }
}

export const approveApproval: AppRouteHandler<ApproveApprovalRoute> =
  resolveHandler("approved")

export const rejectApproval: AppRouteHandler<RejectApprovalRoute> =
  resolveHandler("rejected")
