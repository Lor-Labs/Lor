import type { PermissionRequest } from "@repo/auth/permissions"
import { workspaceAuthorityHasPermissions } from "@repo/auth/permissions"
import { and, asc, db, eq, inArray, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import type { ChangeProposal, ChangeProposalOperation } from "@repo/db/schema"
import { proposalPermissions } from "@repo/db/schema"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { resolveWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { postScopeMessage, startScopeContinuationRun } from "@/lib/scope-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetProposalRoute,
  ListChannelProposalsRoute,
  RejectProposalRoute,
} from "@/routes/v1/proposals/routes"

export function serializeProposal(
  proposal: ChangeProposal,
  operations: ChangeProposalOperation[]
) {
  return {
    id: proposal.id,
    channelId: proposal.channelId,
    cardMessageId: proposal.cardMessageId,
    authorType: proposal.authorType,
    authorUserId: proposal.authorUserId,
    rationale: proposal.rationale,
    evidence: proposal.evidence,
    status: proposal.status,
    resolvedByUserId: proposal.resolvedByUserId,
    resolvedAt: proposal.resolvedAt ? proposal.resolvedAt.toISOString() : null,
    appliedAt: proposal.appliedAt ? proposal.appliedAt.toISOString() : null,
    resolutionNote: proposal.resolutionNote,
    createdAt: proposal.createdAt.toISOString(),
    operations: operations.map((operation) => ({
      id: operation.id,
      position: operation.position,
      kind: operation.kind,
      spec: operation.spec,
      result: operation.result ?? null,
      error: operation.error,
    })),
    requiredPermissions: proposalPermissions(
      operations.map((operation) => operation.spec)
    ),
  }
}

async function loadOperations(
  proposalIds: string[]
): Promise<Map<string, ChangeProposalOperation[]>> {
  const byProposal = new Map<string, ChangeProposalOperation[]>()
  if (proposalIds.length === 0) return byProposal
  const rows = await db
    .select()
    .from(schema.changeProposalOperation)
    .where(inArray(schema.changeProposalOperation.proposalId, proposalIds))
    .orderBy(asc(schema.changeProposalOperation.position))
  for (const row of rows) {
    const list = byProposal.get(row.proposalId) ?? []
    list.push(row)
    byProposal.set(row.proposalId, list)
  }
  return byProposal
}

export const getProposal: AppRouteHandler<GetProposalRoute> = async (c) => {
  const currentUser = c.var.user
  const { proposalId } = c.req.valid("param")

  const proposal = await db
    .select()
    .from(schema.changeProposal)
    .where(eq(schema.changeProposal.id, proposalId))
    .limit(1)
    .then((rows) => rows[0])
  if (!proposal) {
    return c.json(
      { success: false as const, message: "Proposal not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const canAccess = await userCanAccessChannel(
    proposal.channelId,
    currentUser.id
  )
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const operations = await loadOperations([proposal.id])
  return c.json(
    {
      proposal: serializeProposal(proposal, operations.get(proposal.id) ?? []),
    },
    HttpStatusCodes.OK
  )
}

export const listChannelProposals: AppRouteHandler<
  ListChannelProposalsRoute
> = async (c) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  const canAccess = await userCanAccessChannel(channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const proposals = await db
    .select()
    .from(schema.changeProposal)
    .where(
      and(
        eq(schema.changeProposal.channelId, channelId),
        eq(schema.changeProposal.status, "pending")
      )
    )
    .limit(50)
  const operations = await loadOperations(proposals.map((p) => p.id))

  return c.json(
    {
      proposals: proposals.map((proposal) =>
        serializeProposal(proposal, operations.get(proposal.id) ?? [])
      ),
    },
    HttpStatusCodes.OK
  )
}

export const rejectProposal: AppRouteHandler<RejectProposalRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { proposalId } = c.req.valid("param")
  const { note } = c.req.valid("json")

  const row = await db
    .select({ proposal: schema.changeProposal, workspace: schema.workspace })
    .from(schema.changeProposal)
    .innerJoin(
      schema.workspace,
      eq(schema.changeProposal.workspaceId, schema.workspace.id)
    )
    .where(eq(schema.changeProposal.id, proposalId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) {
    return c.json(
      { success: false as const, message: "Proposal not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { proposal } = row

  // Channel write access is the floor: someone who cannot speak in the
  // conversation can never resolve what happens in it.
  const access = await resolveChannelAccess(currentUser.id, proposal.channelId)
  if (!access.ok) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (!access.access.canWrite) {
    return c.json(
      { success: false as const, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const member = await db
    .select()
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, proposal.workspaceId),
        eq(schema.workspaceMember.userId, currentUser.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Resolver gate: the same authority union approving requires — the keys come
  // from the op vocabulary's own statement mapping, hence the honest cast.
  const operations = await loadOperations([proposal.id])
  const ops = operations.get(proposal.id) ?? []
  const authority = await resolveWorkspaceAuthority(member, row.workspace)
  const required = proposalPermissions(
    ops.map((operation) => operation.spec)
  ) as PermissionRequest
  if (!workspaceAuthorityHasPermissions(authority, required)) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // CAS: only one resolver wins; a second click reads as already resolved.
  const rejected = await db
    .update(schema.changeProposal)
    .set({
      status: "rejected",
      resolvedByUserId: currentUser.id,
      resolvedAt: new Date(),
      resolutionNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.changeProposal.id, proposalId),
        eq(schema.changeProposal.status, "pending")
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!rejected) {
    return c.json(
      { success: false as const, message: "Already resolved" },
      HttpStatusCodes.CONFLICT
    )
  }

  // The resolution message lands in the card thread as the rejecter and
  // triggers the revision continuation. If it can't post, un-resolve the CAS
  // so the caller can retry — a 200 without the message would strand the
  // proposal in a state Merlin never hears about.
  if (proposal.cardMessageId) {
    const content = note
      ? `Rejected the proposed changes: ${note}`
      : "Rejected the proposed changes."
    const messageId = await postScopeMessage({
      channelId: proposal.channelId,
      threadRootId: proposal.cardMessageId,
      authorId: currentUser.id,
      content,
    }).catch(() => null)
    if (!messageId) {
      await db
        .update(schema.changeProposal)
        .set({
          status: "pending",
          resolvedByUserId: null,
          resolvedAt: null,
          resolutionNote: null,
        })
        .where(
          and(
            eq(schema.changeProposal.id, proposalId),
            eq(schema.changeProposal.status, "rejected"),
            eq(schema.changeProposal.resolvedByUserId, currentUser.id)
          )
        )
        .catch(() => {})
      return c.json(
        { success: false as const, message: "Failed to post the rejection" },
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      )
    }

    // Best-effort: the revision run answers the rejection in the card thread.
    try {
      await startScopeContinuationRun({
        workspaceId: proposal.workspaceId,
        channelId: proposal.channelId,
        scopeKey: proposal.cardMessageId,
        threadRootId: proposal.cardMessageId,
        triggerMessageId: messageId,
        senderId: currentUser.id,
      })
    } catch (err) {
      logger.error(
        { err, proposalId },
        "Proposal rejection continuation failed"
      )
    }
  }

  return c.json(
    { proposal: serializeProposal(rejected, ops) },
    HttpStatusCodes.OK
  )
}
