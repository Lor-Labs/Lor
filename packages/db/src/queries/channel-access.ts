import { and, eq } from "drizzle-orm"
import { db } from "../index"
import { channel, channelMember } from "../schemas/channels"
import { project } from "../schemas/projects"
import { workspaceMember } from "../schemas/workspace-members"
import { workspace } from "../schemas/workspaces"

// THE channel-audience resolver — every surface that asks "who can see this
// channel / who receives its fanout" goes through here (API, realtime,
// messaging fanout, worker retrieval scoping). Audience lives on the access
// CONTAINER: the parent category when the channel is inside one, else the
// channel itself. DMs/group DMs keep their channel_member semantics.

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
  // "not_found" covers missing AND forbidden — a private channel's existence
  // and name never leak through errors.
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
 * Everyone who can see the channel plus the effective audience kind — the
 * fanout/recipient set and what broadcast mentions mean here: @channel/@here
 * ping this set; @everyone is only honored when the audience is the whole
 * workspace (it's rejected in members-only channels and DMs — there is no
 * "all-company channel" concept to widen to).
 */
export type ChannelAudienceInfo = {
  audience: "workspace" | "members" | "dm" | null
  userIds: string[]
}

export async function resolveChannelAudienceInfo(
  channelId: string
): Promise<ChannelAudienceInfo> {
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
  if (!row) return { audience: null, userIds: [] }

  // DMs / group DMs: the channel's member rows.
  if (!row.workspaceId) {
    return { audience: "dm", userIds: await listChannelMemberUserIds(row.id) }
  }

  const container = await resolveAccessContainer(row)
  if (container.audience === "members") {
    // Membership rows are the audience, but still gate on workspace
    // membership so a stale row for a kicked member never receives fanout.
    const [containerMembers, workspaceMembers] = await Promise.all([
      listChannelMemberUserIds(container.id),
      listWorkspaceMemberUserIds(row.workspaceId),
    ])
    const workspaceSet = new Set(workspaceMembers)
    return {
      audience: "members",
      userIds: containerMembers.filter((id) => workspaceSet.has(id)),
    }
  }

  return {
    audience: "workspace",
    userIds: await listWorkspaceMemberUserIds(row.workspaceId),
  }
}

/**
 * Everyone who can see the channel — the fanout/recipient set and the meaning
 * of `@channel`. Includes the author; callers drop them.
 */
export async function listChannelAudienceUserIds(
  channelId: string
): Promise<string[]> {
  return (await resolveChannelAudienceInfo(channelId)).userIds
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

/**
 * Ids of every workspace channel the user can access — the bulk companion to
 * resolveChannelAccess for list/search/unread paths, so they filter with two
 * queries instead of N resolver calls. Assumes the caller already verified
 * workspace membership (all existing callers run behind that middleware).
 */
export async function listAccessibleChannelIds(
  userId: string,
  workspaceId: string
): Promise<Set<string>> {
  const [channels, memberships] = await Promise.all([
    db
      .select({
        id: channel.id,
        parentId: channel.parentId,
        audience: channel.audience,
      })
      .from(channel)
      .where(eq(channel.workspaceId, workspaceId)),
    db
      .select({ channelId: channelMember.channelId })
      .from(channelMember)
      .where(eq(channelMember.userId, userId))
      .then((rows) => new Set(rows.map((row) => row.channelId))),
  ])

  const audienceById = new Map(channels.map((ch) => [ch.id, ch.audience]))
  const accessible = new Set<string>()
  for (const ch of channels) {
    const containerId = ch.parentId ?? ch.id
    const containerAudience = audienceById.get(containerId) ?? ch.audience
    if (containerAudience === "workspace" || memberships.has(containerId)) {
      accessible.add(ch.id)
    }
  }
  return accessible
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

// ── Merlin run scope ────────────────────────────────────────────────

export type MerlinRunScope = {
  /** Access container whose scoped brain nodes join retrieval and receive writes. */
  memoryScopeChannelId: string | null
  /** Brain folder scoped memory writes are confined under. */
  memoryFolderPath: string | null
  /** Private container whose messages the run may search (null = public only). */
  privateContainerChannelId: string | null
}

export const EMPTY_MERLIN_RUN_SCOPE: MerlinRunScope = {
  memoryScopeChannelId: null,
  memoryFolderPath: null,
  privateContainerChannelId: null,
}

/**
 * A Merlin run's retrieval/write boundary, from the channel it lives in.
 * Channel-scoped on purpose: everyone who can see the channel sees the
 * answer. Projects AND standalone private channels get memory scope — an
 * #admins conversation must never write memory public runs can retrieve.
 */
export async function resolveMerlinRunScope(
  channelId: string
): Promise<MerlinRunScope> {
  const row = await db
    .select({
      id: channel.id,
      parentId: channel.parentId,
      audience: channel.audience,
      workspaceId: channel.workspaceId,
      name: channel.name,
    })
    .from(channel)
    .where(eq(channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.workspaceId) return EMPTY_MERLIN_RUN_SCOPE

  let container = { id: row.id, audience: row.audience, name: row.name }
  if (row.parentId) {
    const parent = await db
      .select({
        id: channel.id,
        audience: channel.audience,
        name: channel.name,
      })
      .from(channel)
      .where(eq(channel.id, row.parentId))
      .limit(1)
      .then((rows) => rows[0])
    if (parent) container = parent
  }

  const projectRow = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.categoryChannelId, container.id))
    .limit(1)
    .then((rows) => rows[0])

  const isPrivate = container.audience === "members"
  const hasMemoryScope = Boolean(projectRow) || isPrivate

  // Folder segments can't contain the path separator.
  const folderName = (container.name ?? "untitled").replaceAll("/", "-").trim()

  return {
    memoryScopeChannelId: hasMemoryScope ? container.id : null,
    memoryFolderPath: hasMemoryScope
      ? `/${projectRow ? "projects" : "channels"}/${folderName}`
      : null,
    privateContainerChannelId: isPrivate ? container.id : null,
  }
}
