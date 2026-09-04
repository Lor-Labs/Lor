import type { PermissionRequest } from "@repo/auth/permissions"
import { workspaceAuthorityHasPermissions } from "@repo/auth/permissions"
import { and, asc, db, desc, eq, inArray, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import type { ChangeProposal, ChangeProposalOperation } from "@repo/db/schema"
import { proposalPermissions } from "@repo/db/schema"
import { channelRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import {
  type ApproverSecrets,
  applyProposal,
  operationSummary,
} from "@/lib/change-proposals"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { resolveWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { postScopeMessage, startScopeContinuationRun } from "@/lib/scope-runs"
import type { AppRouteHandler, Workspace } from "@/lib/types/app-types"
import type {
  ApproveProposalRoute,
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

  // All statuses: resolved cards still render their terminal state (applied
  // provenance, failure, rejection) on reload.
  const proposals = await db
    .select()
    .from(schema.changeProposal)
    .where(eq(schema.changeProposal.channelId, channelId))
    .orderBy(desc(schema.changeProposal.createdAt))
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

type ResolutionAuth =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "archived" }
  | {
      kind: "ok"
      proposal: ChangeProposal
      workspace: Workspace
      ops: ChangeProposalOperation[]
    }

// Shared approve/reject gate: channel write access is the floor, then the
// resolver's authority must cover the union of statements the ops touch.
async function authorizeResolution(
  proposalId: string,
  userId: string
): Promise<ResolutionAuth> {
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
  if (!row) return { kind: "not_found" }
  const { proposal } = row

  const access = await resolveChannelAccess(userId, proposal.channelId)
  if (!access.ok) return { kind: "forbidden" }
  if (!access.access.canWrite) return { kind: "archived" }

  const member = await db
    .select()
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, proposal.workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) return { kind: "forbidden" }

  const operations = await loadOperations([proposal.id])
  const ops = operations.get(proposal.id) ?? []
  const authority = await resolveWorkspaceAuthority(member, row.workspace)
  // The keys come from the op vocabulary's own statement mapping, hence the
  // honest cast.
  const required = proposalPermissions(
    ops.map((operation) => operation.spec)
  ) as PermissionRequest
  if (!workspaceAuthorityHasPermissions(authority, required)) {
    return { kind: "forbidden" }
  }
  return { kind: "ok", proposal, workspace: row.workspace, ops }
}

async function emitProposalUpdated(proposal: ChangeProposal): Promise<void> {
  try {
    const io = await getEmitter()
    io.to(channelRoom(proposal.channelId)).emit("proposal:updated", {
      proposalId: proposal.id,
      channelId: proposal.channelId,
      status: proposal.status,
    })
  } catch (err) {
    logger.warn(
      { err, proposalId: proposal.id },
      "Proposal broadcast failed; continuing"
    )
  }
}

// Post the resolution into the card thread as the resolver and start the
// follow-up continuation run. Best-effort by design for approve (the config
// is already applied); reject un-resolves on failure at its call site.
async function postResolutionAndContinue(args: {
  proposal: ChangeProposal
  authorId: string
  content: string
}): Promise<string | null> {
  const { proposal } = args
  if (!proposal.cardMessageId) return null
  const messageId = await postScopeMessage({
    channelId: proposal.channelId,
    threadRootId: proposal.cardMessageId,
    authorId: args.authorId,
    content: args.content,
  }).catch(() => null)
  if (!messageId) return null
  try {
    await startScopeContinuationRun({
      workspaceId: proposal.workspaceId,
      channelId: proposal.channelId,
      scopeKey: proposal.cardMessageId,
      threadRootId: proposal.cardMessageId,
      triggerMessageId: messageId,
      senderId: args.authorId,
    })
  } catch (err) {
    logger.error(
      { err, proposalId: proposal.id },
      "Proposal resolution continuation failed"
    )
  }
  return messageId
}

export const rejectProposal: AppRouteHandler<RejectProposalRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { proposalId } = c.req.valid("param")
  const { note } = c.req.valid("json")

  const auth = await authorizeResolution(proposalId, currentUser.id)
  if (auth.kind === "not_found") {
    return c.json(
      { success: false as const, message: "Proposal not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (auth.kind === "forbidden") {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (auth.kind === "archived") {
    return c.json(
      { success: false as const, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const { proposal, ops } = auth

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

  // The rejection note is what Merlin revises against — if it can't land in
  // the thread, un-resolve the CAS so the caller can retry.
  if (proposal.cardMessageId) {
    const messageId = await postResolutionAndContinue({
      proposal: rejected,
      authorId: currentUser.id,
      content: note
        ? `Rejected the proposed changes: ${note}`
        : "Rejected the proposed changes.",
    })
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
  }

  await emitProposalUpdated(rejected)
  return c.json(
    { proposal: serializeProposal(rejected, ops) },
    HttpStatusCodes.OK
  )
}

export const approveProposal: AppRouteHandler<ApproveProposalRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { proposalId } = c.req.valid("param")
  const body = c.req.valid("json")

  const auth = await authorizeResolution(proposalId, currentUser.id)
  if (auth.kind === "not_found") {
    return c.json(
      { success: false as const, message: "Proposal not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (auth.kind === "forbidden") {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (auth.kind === "archived") {
    return c.json(
      { success: false as const, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const { ops } = auth

  // Secrets may only target a create_custom_tool op's declared names — they
  // exist for this request only and are encrypted inside the apply.
  const secrets: ApproverSecrets = new Map()
  for (const [rawPosition, values] of Object.entries(body.secrets ?? {})) {
    const position = Number(rawPosition)
    const target = ops.find((operation) => operation.position === position)
    if (!target || target.spec.op !== "create_custom_tool") {
      return c.json(
        {
          success: false as const,
          message: "Secrets can only be supplied for proposed custom tools",
        },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    const declared = new Set(target.spec.requiredSecrets)
    for (const name of Object.keys(values)) {
      if (!declared.has(name)) {
        return c.json(
          {
            success: false as const,
            message: `The proposal does not declare a "${name}" secret`,
          },
          HttpStatusCodes.BAD_REQUEST
        )
      }
    }
    secrets.set(position, values)
  }

  // CAS pending → approved: one resolver wins; apply happens exactly once.
  const approved = await db
    .update(schema.changeProposal)
    .set({
      status: "approved",
      resolvedByUserId: currentUser.id,
      resolvedAt: new Date(),
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
  if (!approved) {
    return c.json(
      { success: false as const, message: "Already resolved" },
      HttpStatusCodes.CONFLICT
    )
  }

  const outcome = await applyProposal(approved, ops, secrets, currentUser.id)

  // Reload the durable rows — apply wrote provenance (or the failure).
  const [settled, operations] = await Promise.all([
    db
      .select()
      .from(schema.changeProposal)
      .where(eq(schema.changeProposal.id, proposalId))
      .limit(1)
      .then((rows) => rows[0] ?? approved),
    loadOperations([proposalId]),
  ])
  const settledOps = operations.get(proposalId) ?? ops

  // Both outcomes post into the card thread as the approver and start the
  // continuation: on success Merlin gets the apply results (webhook URL and
  // friends) to finish integration; on failure it gets the error to revise.
  // Best-effort — the config outcome is already durable.
  const content = outcome.ok
    ? [
        "Approved and applied the proposed changes.",
        ...settledOps.map(
          (operation) =>
            `- ${operationSummary(operation.spec, operation.result ?? null)}`
        ),
      ].join("\n")
    : `Approving the proposed changes failed: ${outcome.error}`
  await postResolutionAndContinue({
    proposal: settled,
    authorId: currentUser.id,
    content,
  })

  await emitProposalUpdated(settled)
  return c.json(
    { proposal: serializeProposal(settled, settledOps) },
    HttpStatusCodes.OK
  )
}
