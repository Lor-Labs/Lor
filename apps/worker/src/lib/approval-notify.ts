import {
  type ApprovalResolverSpec,
  formatWorkspaceRole,
  isWorkspaceRole,
} from "@repo/auth/permissions"
import { and, asc, db, eq, LOR_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { sendApprovalPush } from "@repo/messaging"
import type {
  ApprovalNotification,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { MAINTENANCE_QUEUE } from "@repo/realtime-types/queues"
import { userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import { Queue } from "bullmq"
import { logger } from "@/lib/logger"
import { visibleNotificationRecipients } from "@/lib/notification-audience"
import {
  PARKED_BRIDGE_LIVE_MS,
  RELEASE_PARKED_BRIDGE_JOB,
  type ReleaseParkedBridgeJobData,
} from "@/lib/session-sandboxes"

// Approval fan-out (LOR-83). Who hears about a parked run, and when:
// - The person whose message triggered the run (R) hears immediately — as the
//   resolver when they can act, as a "waiting on X" notice when they can't.
// - When R can act, everyone else eligible is paged only by the delayed
//   escalation job, and only if the approval is still pending — the common
//   case (R approves their own gate in seconds) pages nobody else.
// - When R can't act (or there is no R — loops, triggered runs), the eligible
//   set is paged immediately: nobody present can unblock it.
// A paused turn files one row per gated call; these rules apply per row, and
// each person gets one ping per set about the rows they can act on.
// Each ping is one surface per person: socket event for connected clients (the
// web/desktop OS notification), mobile push for the offline complement.

export const APPROVAL_ESCALATION_DELAY_MS = 2 * 60 * 1000
export const NOTIFY_APPROVAL_JOB = "notify-approval-escalation"
// Same queue index.ts's maintenance worker consumes; one shared name.
export { MAINTENANCE_QUEUE }

export function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

let maintenanceQueue: Queue | null = null
function getMaintenanceQueue(): Queue {
  maintenanceQueue ??= new Queue(MAINTENANCE_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
  })
  return maintenanceQueue
}

// Page the rest of the eligible set in a couple minutes if nobody resolved it.
// The job re-checks the row, so it self-cancels — no revoke needed.
export async function scheduleApprovalEscalation(
  approvalId: string
): Promise<void> {
  await getMaintenanceQueue().add(
    NOTIFY_APPROVAL_JOB,
    { approvalId },
    {
      delay: APPROVAL_ESCALATION_DELAY_MS,
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    }
  )
}

// A parked Claude Code turn's bridge stops after its live window; the job
// re-checks that the turn still waits (session-sandboxes.ts).
export async function scheduleParkedBridgeRelease(
  data: ReleaseParkedBridgeJobData
): Promise<void> {
  await getMaintenanceQueue().add(RELEASE_PARKED_BRIDGE_JOB, data, {
    delay: PARKED_BRIDGE_LIVE_MS,
    attempts: 2,
    removeOnComplete: true,
    removeOnFail: true,
  })
}

type PresenceRedisClient = {
  smIsMember(key: string, members: string[]): Promise<Array<boolean | number>>
}

type NotifyDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: PresenceRedisClient
}

type ParkedApprovalRow = {
  approvalId: string
  workspaceId: string
  target: string | null
  description: string
  status: string
  runId: string | null
  channelId: string
  threadRootId: string | null
  messageId: string | null
  triggerMessageId: string | null
}

// The still-pending rows of the set this approval belongs to (a paused turn
// files one row per gated call).
async function loadPendingSet(
  approvalId: string
): Promise<ParkedApprovalRow[]> {
  const runId = await db
    .select({ runId: schema.approval.runId })
    .from(schema.approval)
    .where(eq(schema.approval.id, approvalId))
    .then((rows) => rows[0]?.runId ?? null)
  if (!runId) return []
  return db
    .select({
      approvalId: schema.approval.id,
      workspaceId: schema.approval.workspaceId,
      target: schema.approval.target,
      description: schema.approval.description,
      status: schema.approval.status,
      runId: schema.approval.runId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      messageId: schema.agentRun.messageId,
      triggerMessageId: schema.agentRun.triggerMessageId,
    })
    .from(schema.approval)
    .innerJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
    .where(
      and(
        eq(schema.approval.runId, runId),
        eq(schema.approval.status, "pending")
      )
    )
    .orderBy(asc(schema.approval.createdAt), asc(schema.approval.id))
}

// The policy row's resolver spec for this approval's target; null when the
// named resolver dangles (deleted role/user) — owner-only, matching the
// resolve endpoint. No policy row (gate turned off while parked) falls back
// to any_member, also matching the endpoint.
export async function loadResolverSpec(
  workspaceId: string,
  target: string | null
): Promise<ApprovalResolverSpec | null> {
  if (!target) return { kind: "any_member" }
  const policy = await db
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
    .then((rows) => rows[0])
  if (!policy) return { kind: "any_member" }
  switch (policy.resolverKind) {
    case "any_member":
      return { kind: "any_member" }
    case "role":
      return policy.resolverRole
        ? { kind: "role", role: policy.resolverRole }
        : null
    case "user":
      return policy.resolverUserId
        ? { kind: "user", userId: policy.resolverUserId }
        : null
  }
}

// Who the resolver spec names, plus plain words for the "waiting" flavor.
// Owner is the fallback whenever the set would otherwise be empty — a parked
// run must always have someone to hear about it.
async function resolverAudience(
  workspaceId: string,
  spec: ApprovalResolverSpec | null,
  requesterId: string | null
): Promise<{ userIds: string[]; label: string }> {
  const ownerId = await db
    .select({ ownerId: schema.workspace.ownerId })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
    .limit(1)
    .then((rows) => rows[0]?.ownerId ?? null)
  const ownerFallback = ownerId ? [ownerId] : []

  if (!spec) return { userIds: ownerFallback, label: "the workspace owner" }
  switch (spec.kind) {
    case "any_member":
      // Everyone in the channel can resolve; a broadcast page would be noise.
      // The requester is the one directed recipient; the in-channel card and
      // the run's own message cover the rest. Headless runs (loops, triggered)
      // have no requester — page the owner so the park is never silent.
      return {
        userIds: requesterId ? [requesterId] : ownerFallback,
        label: "anyone in the channel",
      }
    case "role": {
      const members = await db
        .select({ userId: schema.workspaceMember.userId })
        .from(schema.workspaceMember)
        .where(
          and(
            eq(schema.workspaceMember.workspaceId, workspaceId),
            eq(schema.workspaceMember.role, spec.role)
          )
        )
      const label = isWorkspaceRole(spec.role)
        ? `the ${formatWorkspaceRole(spec.role)} role`
        : `the ${spec.role} role`
      return {
        userIds:
          members.length > 0 ? members.map((m) => m.userId) : ownerFallback,
        label,
      }
    }
    case "user": {
      const member = await db
        .select({
          userId: schema.workspaceMember.userId,
          name: schema.user.name,
        })
        .from(schema.workspaceMember)
        .innerJoin(
          schema.user,
          eq(schema.workspaceMember.userId, schema.user.id)
        )
        .where(
          and(
            eq(schema.workspaceMember.workspaceId, workspaceId),
            eq(schema.workspaceMember.userId, spec.userId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!member) {
        return { userIds: ownerFallback, label: "the workspace owner" }
      }
      return { userIds: [member.userId], label: member.name }
    }
  }
}

// The person whose message triggered the parked run; null for headless runs
// (loops, triggered runs) and Lor-authored triggers.
async function requesterOf(row: ParkedApprovalRow): Promise<string | null> {
  if (!row.triggerMessageId) return null
  const authorId = await db
    .select({ authorId: schema.message.authorId })
    .from(schema.message)
    .where(eq(schema.message.id, row.triggerMessageId))
    .limit(1)
    .then((rows) => rows[0]?.authorId ?? null)
  return authorId && authorId !== LOR_USER_ID ? authorId : null
}

async function buildNotification(
  row: ParkedApprovalRow,
  count: number,
  flavor: ApprovalNotification["flavor"],
  resolverLabel: string
): Promise<ApprovalNotification> {
  const [workspace, channel] = await Promise.all([
    db
      .select({ name: schema.workspace.name })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, row.workspaceId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ name: schema.channel.name })
      .from(schema.channel)
      .where(eq(schema.channel.id, row.channelId))
      .limit(1)
      .then((rows) => rows[0]),
  ])
  return {
    approvalId: row.approvalId,
    flavor,
    workspaceId: row.workspaceId,
    workspaceName: workspace?.name ?? "your workspace",
    channelId: row.channelId,
    channelName: channel?.name ?? null,
    threadRootId: row.threadRootId,
    messageId: row.messageId,
    description:
      count > 1
        ? `${row.description} (and ${count - 1} more)`
        : row.description,
    resolverLabel,
  }
}

type Audience = { userIds: string[]; label: string }

async function audiencesOf(
  rows: ParkedApprovalRow[],
  requesterId: string | null
): Promise<Map<string, Audience>> {
  return new Map(
    await Promise.all(
      rows.map(
        async (row) =>
          [
            row.approvalId,
            await resolverAudience(
              row.workspaceId,
              await loadResolverSpec(row.workspaceId, row.target),
              requesterId
            ),
          ] as const
      )
    )
  )
}

// Who gets pinged, and about which rows of the set.
type PingPlan = Map<string, ParkedApprovalRow[]>

function addPing(plan: PingPlan, userId: string, row: ParkedApprovalRow) {
  plan.set(userId, [...(plan.get(userId) ?? []), row])
}

// One ping per person per set, about the rows they can act on; people with
// the same rows share one send.
async function sendPings(
  deps: NotifyDeps,
  plan: PingPlan,
  flavor: ApprovalNotification["flavor"],
  audiences: Map<string, Audience>
) {
  const groups = new Map<
    string,
    { userIds: string[]; rows: ParkedApprovalRow[] }
  >()
  for (const [userId, rows] of plan) {
    const key = rows.map((row) => row.approvalId).join()
    const group = groups.get(key) ?? { userIds: [], rows }
    group.userIds.push(userId)
    groups.set(key, group)
  }
  for (const { userIds, rows } of groups.values()) {
    const [first] = rows
    if (!first) continue
    await notifyUsers(
      deps,
      userIds,
      await buildNotification(
        first,
        rows.length,
        flavor,
        audiences.get(first.approvalId)?.label ?? "a teammate"
      )
    )
  }
}

// One surface per person: the socket event reaches connected clients (which
// render the OS notification); the push covers whoever is offline.
async function notifyUsers(
  deps: NotifyDeps,
  candidates: string[],
  notification: ApprovalNotification
) {
  const userIds = await visibleNotificationRecipients(
    candidates,
    notification.channelId,
    notification.threadRootId
  )
  if (userIds.length === 0) return
  for (const userId of userIds) {
    deps.emitter
      .to(userRoom(userId))
      .emit("notification:approval", notification)
  }
  await sendApprovalPush({ userIds, notification, redis: deps.redis }).catch(
    (err) => {
      logger.error(
        { err, approvalId: notification.approvalId },
        "Approval push send failed"
      )
    }
  )
}

// Immediate phase, called right after the paused run goes terminal, with any
// row of its set. Returns whether the escalation job should be scheduled.
export async function notifyApprovalParked(
  deps: NotifyDeps,
  approvalId: string
): Promise<{ scheduleEscalation: boolean }> {
  const rows = await loadPendingSet(approvalId)
  const [first] = rows
  if (!first) return { scheduleEscalation: false }
  const requesterId = await requesterOf(first)
  const audiences = await audiencesOf(rows, requesterId)

  const now: PingPlan = new Map()
  const waiting: PingPlan = new Map()
  let scheduleEscalation = false
  for (const row of rows) {
    const userIds = audiences.get(row.approvalId)?.userIds ?? []
    if (requesterId && userIds.includes(requesterId)) {
      // The requester can decide this row: page only them now; the rest of
      // its audience waits for the escalation.
      addPing(now, requesterId, row)
      if (userIds.length > 1) scheduleEscalation = true
    } else {
      for (const userId of userIds) addPing(now, userId, row)
      if (requesterId) addPing(waiting, requesterId, row)
    }
  }
  // An actionable ping already brings the requester to the set.
  if (requesterId && now.has(requesterId)) waiting.delete(requesterId)
  await sendPings(deps, now, "actionable", audiences)
  await sendPings(deps, waiting, "waiting", audiences)
  return { scheduleEscalation }
}

// Delayed phase: the requester was paged first but rows they could decide are
// still pending — bring in the rest of those rows' audiences.
export async function escalateApproval(
  deps: NotifyDeps,
  approvalId: string
): Promise<void> {
  const rows = await loadPendingSet(approvalId)
  const [first] = rows
  if (!first) return
  const requesterId = await requesterOf(first)
  if (!requesterId) return
  const audiences = await audiencesOf(rows, requesterId)

  const later: PingPlan = new Map()
  for (const row of rows) {
    const userIds = audiences.get(row.approvalId)?.userIds ?? []
    if (!userIds.includes(requesterId)) continue
    for (const userId of userIds) {
      if (userId !== requesterId) addPing(later, userId, row)
    }
  }
  await sendPings(deps, later, "actionable", audiences)
}
