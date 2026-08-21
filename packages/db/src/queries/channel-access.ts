import { and, eq } from "drizzle-orm"
import { db } from "../index"
import { channel, channelMember } from "../schemas/channels"
import { workspaceMember } from "../schemas/workspace-members"
import { workspace } from "../schemas/workspaces"

// THE channel-audience resolver. Every surface that asks "who can see this
// channel / who receives its fanout" must go through here — API handlers,
// realtime room joins, messaging fanout, worker retrieval scoping. Two
// hand-rolled copies of this check drifted before (api/lib/queries vs
// realtime/services); do not add a third.
//
// Model: audience lives on the channel's ACCESS CONTAINER — the parent
// category when the channel is inside one, else the channel itself. A
// "members" container requires a channel_member row on the container, which
// is how a project folder restricts all its channels with one member list.
// DMs/group DMs keep their existing channel_member semantics.

const DM_CHANNEL_TYPES = ["dm", "group_dm"] as const

type ChannelRow = typeof channel.$inferSelect

export type ResolvedChannelAccess = {
  channel: Pick<
    ChannelRow,
    | "id"
    | "name"
    | "type"
    | "audience"
    | "workspaceId"
    | "parentId"
    | "archivedAt"
  > & { workspaceName: string | null }
  /** Channel whose audience/membership governs access (parent category or self). */
  accessContainerId: string
  /** Effective audience after container inheritance. */
  audience: "workspace" | "members" | "dm"
  /** Workspace role of the requesting user (null for DMs). */
  memberRole: string | null
  memberIsOwner: boolean
  /** False when the channel is archived — reads stay open, writes are rejected. */
  canWrite: boolean
}

export type ChannelAccessResult =
  | { ok: true; access: ResolvedChannelAccess }
  // "not_found" covers both missing channels and channels the user must not
  // discover — a denied caller can never distinguish the two, so a private
  // channel's existence and name never leak through errors.
  | { ok: false; reason: "not_found" }

export async function resolveChannelAccess(
  userId: string,
  channelId: string
): Promise<ChannelAccessResult> {
  const row = await db
    .select({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      audience: channel.audience,
      workspaceId: channel.workspaceId,
      parentId: channel.parentId,
      archivedAt: channel.archivedAt,
      workspaceName: workspace.name,
      workspaceOwnerId: workspace.ownerId,
    })
    .from(channel)
    .leftJoin(workspace, eq(workspace.id, channel.workspaceId))
    .where(eq(channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) return { ok: false, reason: "not_found" }

  // DMs / group DMs: membership on the channel itself, no workspace.
  if (!row.workspaceId) {
    if (
      !DM_CHANNEL_TYPES.includes(row.type as (typeof DM_CHANNEL_TYPES)[number])
    ) {
      return { ok: false, reason: "not_found" }
    }
    const isMember = await hasChannelMemberRow(row.id, userId)
    if (!isMember) return { ok: false, reason: "not_found" }
    return {
      ok: true,
      access: {
        channel: toChannelShape(row),
        accessContainerId: row.id,
        audience: "dm",
        memberRole: null,
        memberIsOwner: false,
        canWrite: row.archivedAt === null,
      },
    }
  }

  // Workspace channels always require workspace membership first.
  const member = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, row.workspaceId),
        eq(workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) return { ok: false, reason: "not_found" }

  const container = await resolveAccessContainer(row)
  if (container.audience === "members") {
    const isMember = await hasChannelMemberRow(container.id, userId)
    if (!isMember) return { ok: false, reason: "not_found" }
  }

  return {
    ok: true,
    access: {
      channel: toChannelShape(row),
      accessContainerId: container.id,
      audience: container.audience,
      memberRole: member.role,
      memberIsOwner: row.workspaceOwnerId === userId,
      canWrite: row.archivedAt === null,
    },
  }
}

/**
 * Everyone who can see the channel — the fanout/recipient set and the meaning
 * of a future `@channel`. Includes the author; callers drop them.
 */
export async function listChannelAudienceUserIds(
  channelId: string
): Promise<string[]> {
  const row = await db
    .select({
      id: channel.id,
      workspaceId: channel.workspaceId,
      audience: channel.audience,
      parentId: channel.parentId,
    })
    .from(channel)
    .where(eq(channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return []

  // DMs / group DMs: the channel's member rows.
  if (!row.workspaceId) return listChannelMemberUserIds(row.id)

  const container = await resolveAccessContainer(row)
  if (container.audience === "members") {
    // Membership rows are the audience, but still gate on workspace
    // membership so a stale row for a kicked member never receives fanout.
    const [containerMembers, workspaceMembers] = await Promise.all([
      listChannelMemberUserIds(container.id),
      listWorkspaceMemberUserIds(row.workspaceId),
    ])
    const workspaceSet = new Set(workspaceMembers)
    return containerMembers.filter((id) => workspaceSet.has(id))
  }

  return listWorkspaceMemberUserIds(row.workspaceId)
}

// Container inheritance: a channel inside a category takes the category's
// audience and member list. Per-channel overrides inside a container are
// deliberately unsupported in v1 — one member list per project.
async function resolveAccessContainer(row: {
  id: string
  audience: "workspace" | "members"
  parentId: string | null
}): Promise<{ id: string; audience: "workspace" | "members" }> {
  if (!row.parentId) return { id: row.id, audience: row.audience }
  const parent = await db
    .select({ id: channel.id, audience: channel.audience })
    .from(channel)
    .where(eq(channel.id, row.parentId))
    .limit(1)
    .then((rows) => rows[0])
  return parent ?? { id: row.id, audience: row.audience }
}

function toChannelShape(row: {
  id: string
  name: string | null
  type: ChannelRow["type"]
  audience: ChannelRow["audience"]
  workspaceId: string | null
  parentId: string | null
  archivedAt: Date | null
  workspaceName: string | null
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    audience: row.audience,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    archivedAt: row.archivedAt,
    workspaceName: row.workspaceName,
  }
}

async function hasChannelMemberRow(
  containerChannelId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: channelMember.id })
    .from(channelMember)
    .where(
      and(
        eq(channelMember.channelId, containerChannelId),
        eq(channelMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(row)
}

function listChannelMemberUserIds(containerChannelId: string) {
  return db
    .select({ userId: channelMember.userId })
    .from(channelMember)
    .where(eq(channelMember.channelId, containerChannelId))
    .then((rows) => rows.map((row) => row.userId))
}

function listWorkspaceMemberUserIds(workspaceId: string) {
  return db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .then((rows) => rows.map((row) => row.userId))
}
