import {
  type ApprovalResolverSpec,
  approvalPolicyResolverSpec,
  canResolveApproval,
} from "@repo/auth/permissions"
import { and, db, eq, isNotNull, isNull, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import {
  VOICE_APPROVAL_WATCH_JOB,
  VOICE_REQUEST_JOB,
  type VoiceApprovalWatchJobData,
} from "@repo/realtime-types/queues"
import { getVoiceQueue } from "@/lib/voice-queue"

// How often a paused request's approvers are checked, and how long the call
// may go without one before the approval is rejected (they may be
// reconnecting).
export const APPROVAL_WATCH_MS = 10_000
export const APPROVER_GRACE_MS = 30_000

type CallScope = { sessionId: string; workspaceId: string; channelId: string }

async function resolverSpec(
  workspaceId: string,
  target: string
): Promise<ApprovalResolverSpec | null> {
  const [policy] = await db
    .select({
      resolverKind: schema.approvalPolicy.resolverKind,
      resolverRole: schema.approvalPolicy.resolverRole,
      resolverUserId: schema.approvalPolicy.resolverUserId,
    })
    .from(schema.approvalPolicy)
    .where(
      and(
        eq(schema.approvalPolicy.workspaceId, workspaceId),
        eq(schema.approvalPolicy.target, target)
      )
    )
    .limit(1)
  // Same fallbacks as the resolve handler: a gate turned off since lets any
  // member through; a dangling named resolver leaves only the owner.
  return policy ? approvalPolicyResolverSpec(policy) : { kind: "any_member" }
}

// People connected to the call right now who can resolve an approval on this
// target: the same rule as chat (named role or person, or any member; the
// owner always can), with write access to the channel as the floor. No
// target (a sandbox ask): anyone in the call with write access.
export async function listCallApprovers(
  scope: CallScope,
  target: string | null
) {
  const [spec, people] = await Promise.all([
    target
      ? resolverSpec(scope.workspaceId, target)
      : ({ kind: "any_member" } as const),
    db
      .selectDistinct({
        userId: schema.voiceSessionParticipant.userId,
        name: schema.user.name,
        role: schema.workspaceMember.role,
        ownerId: schema.workspace.ownerId,
      })
      .from(schema.voiceSessionParticipant)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.voiceSessionParticipant.userId)
      )
      .innerJoin(
        schema.workspaceMember,
        and(
          eq(
            schema.workspaceMember.userId,
            schema.voiceSessionParticipant.userId
          ),
          eq(schema.workspaceMember.workspaceId, scope.workspaceId)
        )
      )
      .innerJoin(
        schema.workspace,
        eq(schema.workspace.id, schema.workspaceMember.workspaceId)
      )
      .where(
        and(
          eq(schema.voiceSessionParticipant.sessionId, scope.sessionId),
          isNotNull(schema.voiceSessionParticipant.connectedAt)
        )
      ),
  ])
  const approvers: { userId: string; name: string }[] = []
  for (const person of people) {
    const authority = {
      role: person.role,
      isOwner: person.ownerId === person.userId,
    }
    const allowed = spec
      ? canResolveApproval(authority, spec, person.userId)
      : authority.isOwner
    if (!allowed) continue
    const access = await resolveChannelAccess(person.userId, scope.channelId)
    if (access.ok && access.access.canWrite) {
      approvers.push({ userId: person.userId, name: person.name })
    }
  }
  return approvers
}

export async function scheduleApprovalWatch(data: VoiceApprovalWatchJobData) {
  await getVoiceQueue().add(VOICE_APPROVAL_WATCH_JOB, data, {
    delay: APPROVAL_WATCH_MS,
    attempts: 2,
    removeOnComplete: true,
    removeOnFail: true,
  })
}

// Continues the paused request now that its approval is resolved.
export async function enqueueApprovalResume(
  requestId: string,
  approvalId: string
) {
  await getVoiceQueue().add(
    VOICE_REQUEST_JOB,
    { requestId, resumeApprovalId: approvalId },
    {
      // BullMQ rejects ":" in custom ids.
      jobId: `${requestId}-${approvalId}`,
      attempts: 2,
      backoff: { type: "fixed", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 86_400 },
    }
  )
}

// The call ended while a set waited: nobody can decide any of it.
export async function expireApprovalSet(runId: string) {
  await db
    .update(schema.approval)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(
      and(
        eq(schema.approval.runId, runId),
        eq(schema.approval.status, "pending")
      )
    )
}

// Settles a still-pending approval without a person: rejected when the
// approvers left the call (Lor is told).
export async function settleApprovalUnresolved(
  approvalId: string,
  status: "rejected"
) {
  const [row] = await db
    .update(schema.approval)
    .set({ status, resolvedAt: new Date() })
    .where(
      and(
        eq(schema.approval.id, approvalId),
        eq(schema.approval.status, "pending"),
        isNull(schema.approval.resolvedBy)
      )
    )
    .returning({ id: schema.approval.id })
  return Boolean(row)
}

export async function loadApproval(approvalId: string) {
  const [row] = await db
    .select({
      status: schema.approval.status,
      target: schema.approval.target,
    })
    .from(schema.approval)
    .where(eq(schema.approval.id, approvalId))
    .limit(1)
  return row ?? null
}
