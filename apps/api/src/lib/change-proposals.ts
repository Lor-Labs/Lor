import { randomBytes, randomUUID } from "node:crypto"
import { isWorkspaceRole } from "@repo/auth/permissions"
import {
  availableCapabilities,
  CAPABILITIES,
  isConnectorEvent,
  parseApprovalTargetKey,
} from "@repo/connectors"
import { and, db, eq, isUniqueViolation, max, schema, sql } from "@repo/db"
import type {
  ChangeOperation,
  ChangeProposal,
  ChangeProposalOperation,
  MerlinCapability,
  OperationResult,
  ResourceRef,
} from "@repo/db/schema"
import {
  changeOperationSchema,
  validateWorkspaceInstructionsContent,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  bodyMustBeJson,
  bodyTemplateJsonIssue,
  customToolUrlIssue,
  RESERVED_TOOL_NAMES,
} from "@repo/lor/custom-tools"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/lor/loop-schedule"
import { endAfterToDate } from "@repo/lor/loops"
import { initialMcpServerOAuthStatus } from "@repo/lor/mcp-server-oauth"
import { encryptSecret } from "@repo/utils/crypto"

// Apply engine for workspace change proposals (pillar 3,
// reference/change-proposals.md). One transaction over every operation — a
// failure anywhere rolls back everything and the proposal lands `failed` with
// the failing op's error. Each applier re-validates exactly like the real
// route handler for its resource, because approval-time state can differ from
// proposal-time state.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class OperationApplyError extends Error {
  constructor(
    public readonly position: number,
    message: string
  ) {
    super(message)
  }
}

// Approver-typed secret values, keyed by op position then secret name. They
// exist only for the lifetime of the request and are encrypted before insert.
export type ApproverSecrets = Map<number, Record<string, string>>

type ApplyContext = {
  tx: Tx
  workspaceId: string
  approverId: string
  authorUserId: string | null
  rationale: string
  // position → created resource id, for `created` refs in later ops.
  createdIds: Map<number, string>
  kinds: Map<number, ChangeOperation["op"]>
  secrets: ApproverSecrets
}

function fail(position: number, message: string): never {
  throw new OperationApplyError(position, message)
}

async function resolveChannelRef(
  ctx: ApplyContext,
  ref: ResourceRef,
  position: number
): Promise<string> {
  if (ref.kind === "created") {
    if (ctx.kinds.get(ref.opPosition) !== "create_channel") {
      fail(position, "Referenced operation does not create a channel")
    }
    const id = ctx.createdIds.get(ref.opPosition)
    if (!id) fail(position, "Referenced channel was not created")
    return id
  }
  const row = await ctx.tx
    .select({ id: schema.channel.id })
    .from(schema.channel)
    .where(
      and(
        eq(schema.channel.id, ref.id),
        eq(schema.channel.workspaceId, ctx.workspaceId),
        eq(schema.channel.type, "text")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row) fail(position, "Channel not found")
  return row.id
}

const SECRET_REF_REGEX = /\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g

function referencedSecretNames(
  spec: Extract<ChangeOperation, { op: "create_custom_tool" }>
): Set<string> {
  const haystack = [
    spec.urlTemplate,
    spec.bodyTemplate ?? "",
    ...Object.values(spec.headers),
  ].join("\n")
  const names = new Set<string>()
  for (const match of haystack.matchAll(SECRET_REF_REGEX)) {
    const name = match[1]
    if (name) names.add(name)
  }
  return names
}

async function applyOperation(
  ctx: ApplyContext,
  position: number,
  spec: ChangeOperation
): Promise<OperationResult> {
  switch (spec.op) {
    case "create_channel": {
      const inserted = await ctx.tx
        .insert(schema.channel)
        .values({
          workspaceId: ctx.workspaceId,
          name: spec.name,
          topic: spec.topic,
          type: "text",
          audience: "workspace",
        })
        .returning({ id: schema.channel.id })
        .then((rows) => rows[0])
      if (!inserted) fail(position, "Failed to create the channel")
      ctx.createdIds.set(position, inserted.id)
      return { resourceId: inserted.id }
    }

    case "create_webhook": {
      const key = env.INTEGRATION_ENCRYPTION_KEY
      if (!key) fail(position, "Webhooks are not configured on this server")
      const channelId = await resolveChannelRef(ctx, spec.channel, position)
      // Same serialization + cap as the route: lock the channel row.
      await ctx.tx
        .select({ id: schema.channel.id })
        .from(schema.channel)
        .where(eq(schema.channel.id, channelId))
        .for("update")
      const existing = await ctx.tx
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.connectorTrigger)
        .innerJoin(
          schema.integrationConnection,
          eq(
            schema.connectorTrigger.connectionId,
            schema.integrationConnection.id
          )
        )
        .where(
          and(
            eq(schema.connectorTrigger.channelId, channelId),
            eq(schema.integrationConnection.provider, "webhook")
          )
        )
        .then((rows) => rows[0]?.value ?? 0)
      if (existing >= 10) {
        fail(position, "The channel already has the maximum of 10 webhooks")
      }
      const token = randomBytes(32).toString("base64url")
      const externalId = randomUUID()
      const connection = await ctx.tx
        .insert(schema.integrationConnection)
        .values({
          workspaceId: ctx.workspaceId,
          provider: "webhook",
          externalId,
          accountLogin: spec.name,
          accessToken: encryptSecret(token, key),
          createdBy: ctx.approverId,
        })
        .returning({ id: schema.integrationConnection.id })
        .then((rows) => rows[0])
      if (!connection) fail(position, "Failed to create the webhook")
      await ctx.tx.insert(schema.connectorTrigger).values({
        connectionId: connection.id,
        event: "data_received",
        channelId,
        post: true,
      })
      ctx.createdIds.set(position, connection.id)
      return {
        resourceId: connection.id,
        url: `${env.NEXT_PUBLIC_API_URL}/v1/webhooks/${externalId}/${token}`,
      }
    }

    case "set_trigger": {
      const connection = await ctx.tx
        .select({
          id: schema.integrationConnection.id,
          provider: schema.integrationConnection.provider,
        })
        .from(schema.integrationConnection)
        .where(
          and(
            eq(schema.integrationConnection.id, spec.connectionId),
            eq(schema.integrationConnection.workspaceId, ctx.workspaceId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!connection) fail(position, "Connector not found")
      if (!isConnectorEvent(connection.provider, spec.event)) {
        fail(position, `Unknown event "${spec.event}" for this connector`)
      }
      const channelId = await resolveChannelRef(ctx, spec.channel, position)
      await ctx.tx
        .insert(schema.connectorTrigger)
        .values({
          connectionId: connection.id,
          event: spec.event,
          channelId,
          post: spec.post,
          remember: spec.remember,
          rememberHint: spec.rememberHint,
          actInstructions: spec.actInstructions,
        })
        .onConflictDoUpdate({
          target: [
            schema.connectorTrigger.connectionId,
            schema.connectorTrigger.event,
          ],
          set: {
            channelId,
            post: spec.post,
            remember: spec.remember,
            rememberHint: spec.rememberHint,
            actInstructions: spec.actInstructions,
          },
        })
      return { resourceId: connection.id }
    }

    case "create_loop": {
      const channelId = await resolveChannelRef(ctx, spec.channel, position)
      const timezone = spec.timezone ?? "UTC"
      const validation = validateLoopSchedule(spec.schedule, timezone)
      if (!validation.ok) fail(position, validation.reason)
      const nextRunAt = nextLoopRunAt(spec.schedule, timezone)
      if (!nextRunAt) fail(position, "Schedule has no future fires")
      if (spec.endCondition && spec.endAfter) {
        fail(position, "A loop can have one end mode, not both")
      }
      // Approving the card IS the high-frequency consent — the schedule is
      // printed on it (mirrors the activate route's confirm round-trip).
      const highFrequency = validation.requiresConfirmation
      const inserted = await ctx.tx
        .insert(schema.loop)
        .values({
          workspaceId: ctx.workspaceId,
          channelId,
          creatorId: ctx.approverId,
          name: spec.name,
          instructions: spec.instructions,
          schedule: spec.schedule,
          // Persist the resolved timezone: the sweep treats an active loop
          // with a null timezone as an invariant violation and pauses it.
          timezone,
          status: "active",
          nextRunAt,
          endCondition: spec.endCondition,
          endAt: spec.endAfter ? endAfterToDate(spec.endAfter) : null,
          ...(highFrequency
            ? {
                highFrequencyConfirmedAt: new Date(),
                highFrequencyConfirmedBy: ctx.approverId,
              }
            : {}),
        })
        .returning({ id: schema.loop.id })
        .then((rows) => rows[0])
      if (!inserted) fail(position, "Failed to create the loop")
      ctx.createdIds.set(position, inserted.id)
      return { resourceId: inserted.id }
    }

    case "update_loop": {
      const loop = await ctx.tx
        .select()
        .from(schema.loop)
        .where(
          and(
            eq(schema.loop.id, spec.loopId),
            eq(schema.loop.workspaceId, ctx.workspaceId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!loop) fail(position, "Loop not found")
      if (loop.status === "completed") {
        fail(position, "Completed loops can't be edited")
      }
      const values: Partial<typeof schema.loop.$inferInsert> = {
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        ...(spec.instructions !== undefined
          ? { instructions: spec.instructions }
          : {}),
        ...(spec.endCondition !== undefined
          ? { endCondition: spec.endCondition, endAt: null }
          : {}),
      }
      if (spec.schedule !== undefined || spec.timezone !== undefined) {
        const effectiveSchedule = spec.schedule ?? loop.schedule
        const effectiveTimezone = spec.timezone ?? loop.timezone ?? "UTC"
        const validation = validateLoopSchedule(
          effectiveSchedule,
          effectiveTimezone
        )
        if (!validation.ok) fail(position, validation.reason)
        if (spec.schedule !== undefined) values.schedule = spec.schedule
        // Null means "reset to default" — store UTC, never null (see above).
        if (spec.timezone !== undefined) {
          values.timezone = spec.timezone ?? "UTC"
        }
        // Approval is the consent (the card shows the new cadence).
        if (validation.requiresConfirmation) {
          values.highFrequencyConfirmedAt = new Date()
          values.highFrequencyConfirmedBy = ctx.approverId
        }
        if (loop.status === "active") {
          const next = nextLoopRunAt(effectiveSchedule, effectiveTimezone)
          if (!next) fail(position, "Schedule has no future fires")
          values.nextRunAt = next
        }
      }
      if (Object.keys(values).length === 0) {
        fail(position, "The loop edit changes nothing")
      }
      // CAS on the status the edit was computed against, like the route.
      const updated = await ctx.tx
        .update(schema.loop)
        .set(values)
        .where(
          and(eq(schema.loop.id, loop.id), eq(schema.loop.status, loop.status))
        )
        .returning({ id: schema.loop.id })
        .then((rows) => rows[0])
      if (!updated) fail(position, "Loop changed while applying; try again")
      return { resourceId: loop.id }
    }

    case "update_instructions": {
      const validation = validateWorkspaceInstructionsContent(spec.content)
      if (!validation.ok) fail(position, validation.reason)
      const active = await ctx.tx
        .select({
          id: schema.workspaceInstructions.id,
          version: schema.workspaceInstructions.version,
        })
        .from(schema.workspaceInstructions)
        .where(
          and(
            eq(schema.workspaceInstructions.workspaceId, ctx.workspaceId),
            eq(schema.workspaceInstructions.state, "active")
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
      const maxVersion = await ctx.tx
        .select({ value: max(schema.workspaceInstructions.version) })
        .from(schema.workspaceInstructions)
        .where(eq(schema.workspaceInstructions.workspaceId, ctx.workspaceId))
        .then((rows) => rows[0]?.value ?? 0)
      if (active) {
        const superseded = await ctx.tx
          .update(schema.workspaceInstructions)
          .set({ state: "superseded" })
          .where(
            and(
              eq(schema.workspaceInstructions.id, active.id),
              eq(schema.workspaceInstructions.state, "active")
            )
          )
          .returning({ id: schema.workspaceInstructions.id })
        if (superseded.length === 0) {
          fail(position, "Instructions changed while applying; try again")
        }
      }
      const inserted = await ctx.tx
        .insert(schema.workspaceInstructions)
        .values({
          workspaceId: ctx.workspaceId,
          version: (maxVersion ?? 0) + 1,
          content: spec.content,
          state: "active",
          authorType: "agent",
          authorUserId: ctx.authorUserId,
          baseVersion: active?.version ?? null,
          rationale: ctx.rationale,
          approvedByUserId: ctx.approverId,
        })
        .returning({ id: schema.workspaceInstructions.id })
        .then((rows) => rows[0])
      if (!inserted) fail(position, "Failed to write the instructions version")
      return { resourceId: inserted.id }
    }

    case "create_agent_profile": {
      const connections = await ctx.tx
        .select({ provider: schema.integrationConnection.provider })
        .from(schema.integrationConnection)
        .where(
          and(
            eq(schema.integrationConnection.workspaceId, ctx.workspaceId),
            eq(schema.integrationConnection.status, "active")
          )
        )
      const connected = new Set(connections.map((row) => row.provider))
      // Same grantability rule as the agent-profiles route, including the
      // deployment-level web gate.
      const grantable = new Set(
        availableCapabilities(connected)
          .filter((cap) => cap.key !== "web" || Boolean(env.EXA_API_KEY))
          .map((cap) => cap.key)
      )
      const capabilities: MerlinCapability[] = []
      for (const value of spec.capabilities) {
        if (!Object.hasOwn(CAPABILITIES, value)) {
          fail(position, `Unknown capability "${value}"`)
        }
        const capability = value as MerlinCapability
        if (!grantable.has(capability)) {
          fail(position, `Capability "${value}" needs a connected provider`)
        }
        capabilities.push(capability)
      }
      const customToolIds = await Promise.all(
        spec.customTools.map((ref) =>
          resolveOwnedRef(ctx, ref, position, "create_custom_tool", {
            table: "custom_tool",
          })
        )
      )
      const mcpServerIds = await Promise.all(
        spec.mcpServers.map((ref) =>
          resolveOwnedRef(ctx, ref, position, "create_mcp_server", {
            table: "mcp_server",
          })
        )
      )
      const inserted = await ctx.tx
        .insert(schema.agentProfile)
        .values({
          workspaceId: ctx.workspaceId,
          name: spec.name,
          capabilities,
          grantsAll: false,
          isDefault: false,
        })
        .returning({ id: schema.agentProfile.id })
        .then((rows) => rows[0])
      if (!inserted) fail(position, "Failed to create the profile")
      const uniqueToolIds = [...new Set(customToolIds)]
      if (uniqueToolIds.length > 0) {
        await ctx.tx.insert(schema.agentProfileCustomTool).values(
          uniqueToolIds.map((customToolId) => ({
            profileId: inserted.id,
            customToolId,
          }))
        )
      }
      const uniqueServerIds = [...new Set(mcpServerIds)]
      if (uniqueServerIds.length > 0) {
        await ctx.tx.insert(schema.agentProfileMcpServer).values(
          uniqueServerIds.map((mcpServerId) => ({
            profileId: inserted.id,
            mcpServerId,
          }))
        )
      }
      ctx.createdIds.set(position, inserted.id)
      return { resourceId: inserted.id }
    }

    case "assign_channel_profile": {
      const channelId = await resolveChannelRef(ctx, spec.channel, position)
      let profileId: string | null = null
      if (spec.profile) {
        if (spec.profile.kind === "created") {
          if (
            ctx.kinds.get(spec.profile.opPosition) !== "create_agent_profile"
          ) {
            fail(position, "Referenced operation does not create a profile")
          }
          profileId = ctx.createdIds.get(spec.profile.opPosition) ?? null
          if (!profileId) fail(position, "Referenced profile was not created")
        } else {
          const row = await ctx.tx
            .select({ id: schema.agentProfile.id })
            .from(schema.agentProfile)
            .where(
              and(
                eq(schema.agentProfile.id, spec.profile.id),
                eq(schema.agentProfile.workspaceId, ctx.workspaceId)
              )
            )
            .limit(1)
            .then((rows) => rows[0])
          if (!row) fail(position, "Agent profile not found")
          profileId = row.id
        }
      }
      const updated = await ctx.tx
        .update(schema.channel)
        .set({ agentProfileId: profileId })
        .where(
          and(
            eq(schema.channel.id, channelId),
            eq(schema.channel.workspaceId, ctx.workspaceId)
          )
        )
        .returning({ id: schema.channel.id })
        .then((rows) => rows[0])
      if (!updated) fail(position, "Channel not found")
      return { resourceId: channelId }
    }

    case "create_custom_tool": {
      const key = env.INTEGRATION_ENCRYPTION_KEY
      if (!key) fail(position, "Custom tools are not configured on this server")
      if (RESERVED_TOOL_NAMES.has(spec.name)) {
        fail(position, `"${spec.name}" is a built-in tool name`)
      }
      const urlIssue = customToolUrlIssue(spec.urlTemplate)
      if (urlIssue) fail(position, urlIssue)
      if (spec.bodyTemplate && bodyMustBeJson(spec.headers)) {
        const bodyIssue = bodyTemplateJsonIssue(spec.bodyTemplate)
        if (bodyIssue) fail(position, `Body must be valid JSON (${bodyIssue})`)
      }
      // Every secret the templates reference must be declared, so the card
      // knew to ask the approver for it.
      const referenced = referencedSecretNames(spec)
      const declared = new Set(spec.requiredSecrets)
      for (const name of referenced) {
        if (!declared.has(name)) {
          fail(position, `Template references undeclared secret "${name}"`)
        }
      }
      const provided = ctx.secrets.get(position) ?? {}
      for (const name of Object.keys(provided)) {
        if (!declared.has(name)) {
          fail(position, `Unexpected secret "${name}"`)
        }
      }
      const secrets = Object.fromEntries(
        Object.entries(provided).map(([name, value]) => [
          name,
          encryptSecret(value, key),
        ])
      )
      const inserted = await ctx.tx
        .insert(schema.customTool)
        .values({
          workspaceId: ctx.workspaceId,
          createdBy: ctx.approverId,
          name: spec.name,
          description: spec.description,
          argsSchema: spec.argsSchema,
          method: spec.method,
          urlTemplate: spec.urlTemplate,
          headers: spec.headers,
          bodyTemplate: spec.bodyTemplate,
          secrets,
        })
        .returning({ id: schema.customTool.id })
        .then((rows) => rows[0])
        .catch((err) => {
          // Only a unique violation means a name conflict; anything else
          // surfaces as the generic apply failure with its real cause logged.
          if (isUniqueViolation(err)) {
            fail(position, `A tool named "${spec.name}" already exists`)
          }
          throw err
        })
      if (!inserted) {
        fail(position, "Failed to create the tool")
      }
      ctx.createdIds.set(position, inserted.id)
      const missing = spec.requiredSecrets.filter((name) => !(name in provided))
      return {
        resourceId: inserted.id,
        ...(missing.length > 0
          ? {
              setupNote: `Add the ${missing.join(", ")} secret${missing.length === 1 ? "" : "s"} in Settings → Tools before this tool will work.`,
            }
          : {}),
      }
    }

    case "create_mcp_server": {
      const key = env.INTEGRATION_ENCRYPTION_KEY
      if (!key) fail(position, "MCP servers are not configured on this server")
      const urlIssue = customToolUrlIssue(spec.url)
      if (urlIssue) fail(position, urlIssue)
      const inserted = await ctx.tx
        .insert(schema.mcpServer)
        .values({
          workspaceId: ctx.workspaceId,
          createdBy: ctx.approverId,
          name: spec.name,
          description: spec.description,
          url: spec.url,
          authMode: spec.authMode,
          oauthStatus: initialMcpServerOAuthStatus(spec.authMode),
          headers: {},
          secrets: {},
          enabledTools: [],
        })
        .returning({ id: schema.mcpServer.id })
        .then((rows) => rows[0])
        .catch((err) => {
          if (isUniqueViolation(err)) {
            fail(position, `A server named "${spec.name}" already exists`)
          }
          throw err
        })
      if (!inserted) {
        fail(position, "Failed to create the MCP server")
      }
      ctx.createdIds.set(position, inserted.id)
      return {
        resourceId: inserted.id,
        setupNote:
          spec.authMode === "oauth"
            ? "Connect this MCP server in Settings → Tools (OAuth) before Merlin can use it."
            : "Review this MCP server in Settings → Tools and enable the tools Merlin may use.",
      }
    }

    case "set_approval_policy": {
      let targetKey: string
      if (spec.target.kind === "created") {
        const kind = ctx.kinds.get(spec.target.opPosition)
        const id = ctx.createdIds.get(spec.target.opPosition)
        if (kind === "create_custom_tool" && id) {
          targetKey = `custom_tool:${id}`
        } else if (kind === "create_mcp_server" && id) {
          targetKey = `mcp_server:${id}`
        } else {
          fail(position, "Referenced operation does not create a gateable tool")
        }
      } else {
        const parsed = parseApprovalTargetKey(spec.target.key)
        if (!parsed) fail(position, "Unknown approval target")
        if (parsed.kind === "customTool") {
          const owned = await ctx.tx
            .select({ id: schema.customTool.id })
            .from(schema.customTool)
            .where(
              and(
                eq(schema.customTool.id, parsed.customToolId),
                eq(schema.customTool.workspaceId, ctx.workspaceId)
              )
            )
            .limit(1)
            .then((rows) => rows[0])
          if (!owned) fail(position, "Unknown custom tool")
        }
        if (parsed.kind === "mcpServer") {
          const owned = await ctx.tx
            .select({ id: schema.mcpServer.id })
            .from(schema.mcpServer)
            .where(
              and(
                eq(schema.mcpServer.id, parsed.mcpServerId),
                eq(schema.mcpServer.workspaceId, ctx.workspaceId)
              )
            )
            .limit(1)
            .then((rows) => rows[0])
          if (!owned) fail(position, "Unknown MCP server")
        }
        targetKey = spec.target.key
      }
      if (spec.resolverKind === "role" && spec.resolverRole) {
        if (!isWorkspaceRole(spec.resolverRole)) {
          const role = await ctx.tx
            .select({ id: schema.workspaceRole.id })
            .from(schema.workspaceRole)
            .where(
              and(
                eq(schema.workspaceRole.workspaceId, ctx.workspaceId),
                eq(schema.workspaceRole.role, spec.resolverRole)
              )
            )
            .limit(1)
            .then((rows) => rows[0])
          if (!role) fail(position, `Unknown role "${spec.resolverRole}"`)
        }
      }
      if (spec.resolverKind === "role" && !spec.resolverRole) {
        fail(position, "A role resolver needs a role name")
      }
      if (spec.resolverKind === "user") {
        if (!spec.resolverUserId) fail(position, "A user resolver needs a user")
        const member = await ctx.tx
          .select({ userId: schema.workspaceMember.userId })
          .from(schema.workspaceMember)
          .where(
            and(
              eq(schema.workspaceMember.workspaceId, ctx.workspaceId),
              eq(schema.workspaceMember.userId, spec.resolverUserId)
            )
          )
          .limit(1)
          .then((rows) => rows[0])
        if (!member) fail(position, "Resolver is not a workspace member")
      }
      const values = {
        resolverKind: spec.resolverKind,
        resolverRole: spec.resolverKind === "role" ? spec.resolverRole : null,
        resolverUserId:
          spec.resolverKind === "user" ? spec.resolverUserId : null,
        updatedAt: new Date(),
      }
      const policy = await ctx.tx
        .insert(schema.approvalPolicy)
        .values({ workspaceId: ctx.workspaceId, target: targetKey, ...values })
        .onConflictDoUpdate({
          target: [
            schema.approvalPolicy.workspaceId,
            schema.approvalPolicy.target,
          ],
          set: values,
        })
        .returning({ id: schema.approvalPolicy.id })
        .then((rows) => rows[0])
      if (!policy) fail(position, "Failed to save the approval policy")
      return { resourceId: policy.id }
    }
  }
}

// Shared owned-or-created ref resolution for tool/server grant lists.
async function resolveOwnedRef(
  ctx: ApplyContext,
  ref: ResourceRef,
  position: number,
  createdKind: "create_custom_tool" | "create_mcp_server",
  target: { table: "custom_tool" | "mcp_server" }
): Promise<string> {
  if (ref.kind === "created") {
    if (ctx.kinds.get(ref.opPosition) !== createdKind) {
      fail(position, "Referenced operation creates the wrong kind of resource")
    }
    const id = ctx.createdIds.get(ref.opPosition)
    if (!id) fail(position, "Referenced resource was not created")
    return id
  }
  const table =
    target.table === "custom_tool" ? schema.customTool : schema.mcpServer
  const row = await ctx.tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, ref.id), eq(table.workspaceId, ctx.workspaceId)))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) fail(position, "Referenced tool not found in this workspace")
  return row.id
}

export type ApplyOutcome =
  | { ok: true; results: Map<number, OperationResult> }
  | { ok: false; position: number; error: string }

// Apply every operation in order inside one transaction, write provenance and
// flip the proposal to `applied`. On any failure the transaction rolls back
// (no partial config) and the proposal is marked `failed` outside it.
export async function applyProposal(
  proposal: ChangeProposal,
  operations: ChangeProposalOperation[],
  secrets: ApproverSecrets,
  approverId: string
): Promise<ApplyOutcome> {
  const ordered = [...operations].sort((a, b) => a.position - b.position)
  try {
    // Stored specs re-validate against the vocabulary up front — a row written
    // under an older op shape (or with a null spec) fails with its position
    // recorded instead of crashing while building the kinds map.
    const parsedOps = ordered.map((operation) => {
      const parsed = changeOperationSchema.safeParse(operation.spec)
      if (!parsed.success) {
        fail(operation.position, "Stored operation no longer parses")
      }
      return {
        id: operation.id,
        position: operation.position,
        spec: parsed.data,
      }
    })
    const results = await db.transaction(async (tx) => {
      const ctx: ApplyContext = {
        tx,
        workspaceId: proposal.workspaceId,
        approverId,
        authorUserId: proposal.authorUserId,
        rationale: proposal.rationale,
        createdIds: new Map(),
        kinds: new Map(
          parsedOps.map((operation) => [operation.position, operation.spec.op])
        ),
        secrets,
      }
      const collected = new Map<number, OperationResult>()
      for (const operation of parsedOps) {
        const result = await applyOperation(
          ctx,
          operation.position,
          operation.spec
        )
        collected.set(operation.position, result)
      }
      for (const operation of parsedOps) {
        await tx
          .update(schema.changeProposalOperation)
          .set({ result: collected.get(operation.position) ?? null })
          .where(eq(schema.changeProposalOperation.id, operation.id))
      }
      await tx
        .update(schema.changeProposal)
        .set({
          status: "applied",
          appliedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.changeProposal.id, proposal.id))
      return collected
    })
    return { ok: true, results }
  } catch (err) {
    const position = err instanceof OperationApplyError ? err.position : -1
    const message =
      err instanceof OperationApplyError
        ? err.message
        : "Applying the changes failed"
    // The transaction rolled back; record the failure durably.
    await db
      .update(schema.changeProposal)
      .set({
        status: "failed",
        resolutionNote: message,
        updatedAt: new Date(),
      })
      .where(eq(schema.changeProposal.id, proposal.id))
      .catch(() => {})
    const failing = ordered.find((operation) => operation.position === position)
    if (failing) {
      await db
        .update(schema.changeProposalOperation)
        .set({ error: message })
        .where(eq(schema.changeProposalOperation.id, failing.id))
        .catch(() => {})
    }
    return { ok: false, position, error: message }
  }
}

// Plain-words label per op for the resolution message and card summaries.
export function operationSummary(
  spec: ChangeOperation,
  result: OperationResult | null
): string {
  switch (spec.op) {
    case "create_channel":
      return `Created #${spec.name}`
    case "create_webhook":
      return result?.url
        ? `Webhook "${spec.name}" — URL: ${result.url}`
        : `Created webhook "${spec.name}"`
    case "set_trigger":
      return `Routed the ${spec.event} event`
    case "create_loop":
      return `Created loop "${spec.name}" (${spec.schedule})`
    case "update_loop":
      return "Updated a loop"
    case "update_instructions":
      return "Updated the workspace instructions"
    case "create_agent_profile":
      return `Created agent profile "${spec.name}"`
    case "assign_channel_profile":
      return "Assigned the channel's agent profile"
    case "create_custom_tool":
      return `Created tool ${spec.name}${result?.setupNote ? ` — ${result.setupNote}` : ""}`
    case "create_mcp_server":
      return `Created MCP server "${spec.name}"${result?.setupNote ? ` — ${result.setupNote}` : ""}`
    case "set_approval_policy":
      return "Turned on an approval gate"
  }
}
