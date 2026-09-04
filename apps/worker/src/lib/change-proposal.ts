import {
  type PermissionRequest,
  parseRolePermission,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import { and, db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import type { ChangeOperation, ProposalEvidence } from "@repo/db/schema"
import { proposalPermissions } from "@repo/db/schema"
import { sendProposalPush } from "@repo/messaging"
import type {
  ProposalNotification,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { channelRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postMerlinMessage } from "@/lib/merlin-messages"

type RedisClient = ReturnType<typeof createClient>

export type ChangeProposalDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

// Plain-text fallback line per op (mobile pre-P5, search, notifications) —
// rich rendering reads the rows via cardMessageId.
function proposedLabel(spec: ChangeOperation): string {
  switch (spec.op) {
    case "create_channel":
      return `Create #${spec.name}`
    case "create_webhook":
      return `Create webhook "${spec.name}"`
    case "set_trigger":
      return `Route the ${spec.event} event to a channel`
    case "create_loop":
      return `Create loop "${spec.name}" (${spec.schedule})`
    case "update_loop":
      return "Edit a loop"
    case "update_instructions":
      return "Update the workspace instructions"
    case "create_agent_profile":
      return `Create agent profile "${spec.name}"`
    case "assign_channel_profile":
      return "Assign a channel's agent profile"
    case "create_custom_tool":
      return `Create tool ${spec.name}`
    case "create_mcp_server":
      return `Create MCP server "${spec.name}"`
    case "set_approval_policy":
      return "Require approval for a tool"
  }
}

// The propose_workspace_change executor: proposal_card message + proposal/op
// rows, same card-is-anchor shape as createLoopCard. A newer proposal
// supersedes the channel's previous pending one — Merlin revising after
// feedback must not leave two live cards competing for approval.
export async function createProposalCard(
  deps: ChangeProposalDeps,
  input: {
    workspaceId: string
    channelId: string
    rationale: string
    evidence: ProposalEvidence[]
    operations: ChangeOperation[]
  }
): Promise<{ proposalId: string }> {
  const lines = input.operations.map((spec) => `- ${proposedLabel(spec)}`)
  const { messageId: cardId } = await postMerlinMessage(
    { emitter: deps.emitter, redis: deps.redis },
    {
      channelId: input.channelId,
      content: `Proposed workspace changes:\n${lines.join("\n")}`,
      type: "proposal_card",
    }
  )

  let supersededIds: string[] = []
  const proposal = await db
    .transaction(async (tx) => {
      const superseded = await tx
        .update(schema.changeProposal)
        .set({
          status: "rejected",
          resolutionNote: "Superseded by a newer proposal.",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.changeProposal.channelId, input.channelId),
            eq(schema.changeProposal.status, "pending")
          )
        )
        .returning({ id: schema.changeProposal.id })
      supersededIds = superseded.map((row) => row.id)

      const inserted = await tx
        .insert(schema.changeProposal)
        .values({
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          cardMessageId: cardId,
          authorType: "agent",
          authorUserId: MERLIN_USER_ID,
          rationale: input.rationale,
          evidence: input.evidence,
        })
        .returning()
        .then((rows) => rows[0])
      if (!inserted) throw new Error("Proposal insert returned no row")
      await tx.insert(schema.changeProposalOperation).values(
        input.operations.map((spec, position) => ({
          proposalId: inserted.id,
          position,
          kind: spec.op,
          spec,
        }))
      )
      return inserted
    })
    .catch(async (err) => {
      await db
        .delete(schema.message)
        .where(eq(schema.message.id, cardId))
        .catch(() => {})
      throw err
    })

  // Everything below is best-effort: the card and rows are durable.
  try {
    for (const proposalId of supersededIds) {
      deps.emitter.to(channelRoom(input.channelId)).emit("proposal:updated", {
        proposalId,
        channelId: input.channelId,
        status: "rejected",
      })
    }
    deps.emitter.to(channelRoom(input.channelId)).emit("proposal:updated", {
      proposalId: proposal.id,
      channelId: input.channelId,
      status: "pending",
    })
  } catch (err) {
    logger.error({ err, proposalId: proposal.id }, "Proposal card emit failed")
  }

  try {
    await notifyProposalApprovers(deps, {
      proposalId: proposal.id,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      cardMessageId: cardId,
      rationale: input.rationale,
      operations: input.operations,
    })
  } catch (err) {
    logger.error(
      { err, proposalId: proposal.id },
      "Proposal approver notify failed"
    )
  }

  return { proposalId: proposal.id }
}

// Everyone whose authority covers the proposal's permission union — the people
// who can actually approve it. When the union is empty (loop-only proposals,
// approvable by any member) only owner + admins are pinged: the card's normal
// message fanout already reaches the channel, and a broadcast page is noise.
async function qualifyingApprovers(
  workspaceId: string,
  required: PermissionRequest
): Promise<string[]> {
  const [workspace, members, customRoles] = await Promise.all([
    db
      .select({ ownerId: schema.workspace.ownerId })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        userId: schema.workspaceMember.userId,
        role: schema.workspaceMember.role,
        isBot: schema.user.isBot,
      })
      .from(schema.workspaceMember)
      .innerJoin(schema.user, eq(schema.workspaceMember.userId, schema.user.id))
      .where(eq(schema.workspaceMember.workspaceId, workspaceId)),
    db
      .select({
        role: schema.workspaceRole.role,
        permission: schema.workspaceRole.permission,
      })
      .from(schema.workspaceRole)
      .where(eq(schema.workspaceRole.workspaceId, workspaceId)),
  ])
  if (!workspace) return []
  const grantsByRole = new Map(
    customRoles.map((row) => [row.role, parseRolePermission(row.permission)])
  )
  const broad = Object.keys(required).length === 0
  const userIds: string[] = []
  for (const member of members) {
    if (member.isBot) continue
    const isOwner = member.userId === workspace.ownerId
    if (broad) {
      if (isOwner || member.role === "admin") userIds.push(member.userId)
      continue
    }
    const covers = workspaceAuthorityHasPermissions(
      {
        role: member.role,
        isOwner,
        customGrants: grantsByRole.get(member.role) ?? null,
      },
      required
    )
    if (covers) userIds.push(member.userId)
  }
  return userIds
}

async function notifyProposalApprovers(
  deps: ChangeProposalDeps,
  input: {
    proposalId: string
    workspaceId: string
    channelId: string
    cardMessageId: string
    rationale: string
    operations: ChangeOperation[]
  }
): Promise<void> {
  const required = proposalPermissions(input.operations) as PermissionRequest
  const userIds = await qualifyingApprovers(input.workspaceId, required)
  if (userIds.length === 0) return

  const [workspace, channel] = await Promise.all([
    db
      .select({ name: schema.workspace.name })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ name: schema.channel.name })
      .from(schema.channel)
      .where(eq(schema.channel.id, input.channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])
  const notification: ProposalNotification = {
    proposalId: input.proposalId,
    workspaceId: input.workspaceId,
    workspaceName: workspace?.name ?? "your workspace",
    channelId: input.channelId,
    channelName: channel?.name ?? null,
    cardMessageId: input.cardMessageId,
    rationale: input.rationale,
  }
  for (const userId of userIds) {
    deps.emitter
      .to(userRoom(userId))
      .emit("notification:proposal", notification)
  }
  await sendProposalPush({ userIds, notification, redis: deps.redis }).catch(
    (err) => {
      logger.error(
        { err, proposalId: input.proposalId },
        "Proposal push send failed"
      )
    }
  )
}
