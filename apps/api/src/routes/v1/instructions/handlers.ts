import { and, db, desc, eq, inArray, isUniqueViolation, schema } from "@repo/db"
import {
  type InstructionsProposalUpdate,
  workspaceRoom,
} from "@repo/realtime-types"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ApproveInstructionsProposalRoute,
  GetInstructionsRoute,
  RejectInstructionsProposalRoute,
  UpdateInstructionsRoute,
} from "@/routes/v1/instructions/routes"

async function emitInstructionsUpdated(payload: InstructionsProposalUpdate) {
  try {
    const emitter = await getEmitter()
    emitter
      .to(workspaceRoom(payload.workspaceId))
      .emit("instructions:updated", payload)
  } catch (err) {
    logger.warn({ err, ...payload }, "Instructions update emit failed")
  }
}

const VERSION_HISTORY_LIMIT = 50

class ProposalRaceError extends Error {}

type VersionRow = {
  version: number
  content: string
  state: (typeof schema.workspaceInstructions.$inferSelect)["state"]
  authorType: (typeof schema.workspaceInstructions.$inferSelect)["authorType"]
  authorName: string | null
  baseVersion: number | null
  rationale: string | null
  createdAt: Date
}

function toVersionDto(row: VersionRow) {
  return {
    version: row.version,
    content: row.content,
    state: row.state,
    authorType: row.authorType,
    authorName: row.authorName,
    baseVersion: row.baseVersion,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString(),
  }
}

function versionRowsQuery() {
  return db
    .select({
      version: schema.workspaceInstructions.version,
      content: schema.workspaceInstructions.content,
      state: schema.workspaceInstructions.state,
      authorType: schema.workspaceInstructions.authorType,
      authorName: schema.user.name,
      baseVersion: schema.workspaceInstructions.baseVersion,
      rationale: schema.workspaceInstructions.rationale,
      createdAt: schema.workspaceInstructions.createdAt,
    })
    .from(schema.workspaceInstructions)
    .leftJoin(
      schema.user,
      eq(schema.workspaceInstructions.authorUserId, schema.user.id)
    )
}

async function listVersionRows(workspaceId: string): Promise<VersionRow[]> {
  return versionRowsQuery()
    .where(eq(schema.workspaceInstructions.workspaceId, workspaceId))
    .orderBy(desc(schema.workspaceInstructions.version))
    .limit(VERSION_HISTORY_LIMIT)
}

export const getInstructions: AppRouteHandler<GetInstructionsRoute> = async (
  c
) => {
  const workspace = c.var.workspace

  // Active/pending fetched outside the history window — the active version
  // can be older than the newest VERSION_HISTORY_LIMIT rows.
  const [rows, current] = await Promise.all([
    listVersionRows(workspace.id),
    versionRowsQuery().where(
      and(
        eq(schema.workspaceInstructions.workspaceId, workspace.id),
        inArray(schema.workspaceInstructions.state, ["active", "pending"])
      )
    ),
  ])
  const active = current.find((row) => row.state === "active")
  const pending = current.find((row) => row.state === "pending")
  const canManage = hasWorkspaceAuthority(c.var.authority, {
    instructions: ["update"],
  })
  const canApprove = hasWorkspaceAuthority(c.var.authority, {
    instructions: ["approve"],
  })

  return c.json(
    {
      active: active ? toVersionDto(active) : null,
      pending: pending ? toVersionDto(pending) : null,
      versions: rows.map(toVersionDto),
      canManage,
      canApprove,
    },
    HttpStatusCodes.OK
  )
}

export const updateInstructions: AppRouteHandler<
  UpdateInstructionsRoute
> = async (c) => {
  const workspace = c.var.workspace
  const user = c.var.user
  const { content, baseVersion } = c.req.valid("json")

  assertWorkspaceAuthority(c.var.authority, { instructions: ["update"] })

  const validation = schema.validateWorkspaceInstructionsContent(content)
  if (!validation.ok) {
    return c.json(
      { success: false, message: validation.reason },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [activeRow] = await tx
        .select({
          version: schema.workspaceInstructions.version,
        })
        .from(schema.workspaceInstructions)
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, workspace.id),
            eq(schema.workspaceInstructions.state, "active")
          )
        )
        .limit(1)
      if ((activeRow?.version ?? null) !== baseVersion) return null

      if (activeRow) {
        // Guarded on the exact version read above: if a concurrent edit
        // already replaced it, this matches nothing and we conflict.
        const superseded = await tx
          .update(schema.workspaceInstructions)
          .set({ state: "superseded" })
          .where(
            and(
              eq(schema.workspaceInstructions.workspaceId, workspace.id),
              eq(schema.workspaceInstructions.state, "active"),
              eq(schema.workspaceInstructions.version, activeRow.version)
            )
          )
          .returning({ version: schema.workspaceInstructions.version })
        if (superseded.length === 0) return null
      }

      const [latest] = await tx
        .select({ version: schema.workspaceInstructions.version })
        .from(schema.workspaceInstructions)
        .where(eq(schema.workspaceInstructions.workspaceId, workspace.id))
        .orderBy(desc(schema.workspaceInstructions.version))
        .limit(1)

      const [row] = await tx
        .insert(schema.workspaceInstructions)
        .values({
          workspaceId: workspace.id,
          version: (latest?.version ?? 0) + 1,
          content,
          state: "active",
          authorType: "user",
          authorUserId: user.id,
          baseVersion,
        })
        .returning()
      return row ?? null
    })

    if (!created) {
      return c.json(
        {
          success: false,
          message:
            "The instructions changed since you loaded them — reload and reapply your edit.",
        },
        HttpStatusCodes.CONFLICT
      )
    }

    await emitInstructionsUpdated({
      workspaceId: workspace.id,
      version: created.version,
    })
    return c.json(
      {
        success: true as const,
        active: toVersionDto({ ...created, authorName: user.name }),
      },
      HttpStatusCodes.OK
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        {
          success: false,
          message:
            "The instructions changed since you loaded them — reload and reapply your edit.",
        },
        HttpStatusCodes.CONFLICT
      )
    }
    throw err
  }
}

export const approveInstructionsProposal: AppRouteHandler<
  ApproveInstructionsProposalRoute
> = async (c) => {
  const workspace = c.var.workspace
  const user = c.var.user
  const { version } = c.req.valid("param")

  assertWorkspaceAuthority(c.var.authority, { instructions: ["approve"] })

  try {
    const outcome = await db.transaction(async (tx) => {
      const [proposal] = await tx
        .select({
          version: schema.workspaceInstructions.version,
          state: schema.workspaceInstructions.state,
          baseVersion: schema.workspaceInstructions.baseVersion,
        })
        .from(schema.workspaceInstructions)
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, workspace.id),
            eq(schema.workspaceInstructions.version, version)
          )
        )
        .limit(1)
      if (!proposal || proposal.state !== "pending") return "not_found" as const

      const [activeRow] = await tx
        .select({ version: schema.workspaceInstructions.version })
        .from(schema.workspaceInstructions)
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, workspace.id),
            eq(schema.workspaceInstructions.state, "active")
          )
        )
        .limit(1)
      // The proposal was written against a specific active version; if that
      // changed since, approving would silently discard the newer edit.
      if ((activeRow?.version ?? null) !== proposal.baseVersion) {
        return "conflict" as const
      }

      if (activeRow) {
        const superseded = await tx
          .update(schema.workspaceInstructions)
          .set({ state: "superseded" })
          .where(
            and(
              eq(schema.workspaceInstructions.workspaceId, workspace.id),
              eq(schema.workspaceInstructions.state, "active"),
              eq(schema.workspaceInstructions.version, activeRow.version)
            )
          )
          .returning({ version: schema.workspaceInstructions.version })
        if (superseded.length === 0) return "conflict" as const
      }

      const activated = await tx
        .update(schema.workspaceInstructions)
        .set({ state: "active", approvedByUserId: user.id })
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, workspace.id),
            eq(schema.workspaceInstructions.version, version),
            eq(schema.workspaceInstructions.state, "pending")
          )
        )
        .returning({ version: schema.workspaceInstructions.version })
      // A concurrent approve/reject settled the proposal between the read and
      // this update. Throw (not return) so the supersede above rolls back —
      // committing it would leave the workspace with no active version.
      if (activated.length === 0) throw new ProposalRaceError()
      return "approved" as const
    })

    if (outcome === "not_found") {
      return c.json(
        { success: false, message: "No pending proposal with that version" },
        HttpStatusCodes.NOT_FOUND
      )
    }
    if (outcome === "conflict") {
      return c.json(
        {
          success: false,
          message:
            "The active instructions changed after this was proposed — review the proposal against the current version.",
        },
        HttpStatusCodes.CONFLICT
      )
    }
    await emitInstructionsUpdated({ workspaceId: workspace.id, version })
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  } catch (err) {
    if (isUniqueViolation(err) || err instanceof ProposalRaceError) {
      return c.json(
        {
          success: false,
          message:
            "The active instructions changed after this was proposed — review the proposal against the current version.",
        },
        HttpStatusCodes.CONFLICT
      )
    }
    throw err
  }
}

export const rejectInstructionsProposal: AppRouteHandler<
  RejectInstructionsProposalRoute
> = async (c) => {
  const workspace = c.var.workspace
  const user = c.var.user
  const { version } = c.req.valid("param")

  assertWorkspaceAuthority(c.var.authority, { instructions: ["approve"] })

  const rejected = await db
    .update(schema.workspaceInstructions)
    .set({ state: "rejected", rejectedByUserId: user.id })
    .where(
      and(
        eq(schema.workspaceInstructions.workspaceId, workspace.id),
        eq(schema.workspaceInstructions.version, version),
        eq(schema.workspaceInstructions.state, "pending")
      )
    )
    .returning({ version: schema.workspaceInstructions.version })

  if (rejected.length === 0) {
    return c.json(
      { success: false, message: "No pending proposal with that version" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  await emitInstructionsUpdated({ workspaceId: workspace.id, version })
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
