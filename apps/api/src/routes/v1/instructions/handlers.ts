import { and, db, desc, eq, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ApproveInstructionsProposalRoute,
  GetInstructionsRoute,
  RejectInstructionsProposalRoute,
  UpdateInstructionsRoute,
} from "@/routes/v1/instructions/routes"

const VERSION_HISTORY_LIMIT = 50

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

function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code
  return code === "23505"
}

async function listVersionRows(workspaceId: string): Promise<VersionRow[]> {
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
    .where(eq(schema.workspaceInstructions.workspaceId, workspaceId))
    .orderBy(desc(schema.workspaceInstructions.version))
    .limit(VERSION_HISTORY_LIMIT)
}

export const getInstructions: AppRouteHandler<GetInstructionsRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const member = c.var.member

  const rows = await listVersionRows(workspace.id)
  const active = rows.find((row) => row.state === "active")
  const pending = rows.find((row) => row.state === "pending")
  const canManage =
    workspace.ownerId === member.userId || member.role === "admin"

  return c.json(
    {
      active: active ? toVersionDto(active) : null,
      pending: pending ? toVersionDto(pending) : null,
      versions: rows.map(toVersionDto),
      canManage,
    },
    HttpStatusCodes.OK
  )
}

export const updateInstructions: AppRouteHandler<
  UpdateInstructionsRoute
> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const user = c.var.user
  const { content, baseVersion } = c.req.valid("json")

  assertWorkspacePermission(member, workspace, { instructions: ["update"] })

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
  const member = c.var.member
  const user = c.var.user
  const { version } = c.req.valid("param")

  assertWorkspacePermission(member, workspace, { instructions: ["approve"] })

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

      await tx
        .update(schema.workspaceInstructions)
        .set({ state: "active", approvedByUserId: user.id })
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, workspace.id),
            eq(schema.workspaceInstructions.version, version),
            eq(schema.workspaceInstructions.state, "pending")
          )
        )
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
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  } catch (err) {
    if (isUniqueViolation(err)) {
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
  const member = c.var.member
  const user = c.var.user
  const { version } = c.req.valid("param")

  assertWorkspacePermission(member, workspace, { instructions: ["approve"] })

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
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
