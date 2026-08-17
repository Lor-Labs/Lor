import {
  and,
  count,
  db,
  desc,
  eq,
  inArray,
  isUniqueViolation,
  schema,
} from "@repo/db"
import type { ToolServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { customToolUrlIssue, renderTemplate } from "@repo/merlin/custom-tools"
import { discoverToolServer as discoverMcp } from "@repo/merlin/tool-servers"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateToolServerRoute,
  DeleteToolServerRoute,
  DiscoverToolServerRoute,
  ListToolServersRoute,
  RediscoverToolServerRoute,
  UpdateToolServerRoute,
} from "@/routes/v1/tool-servers/routes"

// Secret values are write-only: stored encrypted, surfaced as names only.
function toResponse(row: ToolServer, usedByProfiles: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    headers: row.headers,
    secretNames: Object.keys(row.secrets),
    enabledTools: row.enabledTools,
    usedByProfiles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function grantCounts(serverIds: string[]): Promise<Map<string, number>> {
  if (serverIds.length === 0) return new Map()
  const rows = await db
    .select({
      toolServerId: schema.agentProfileToolServer.toolServerId,
      profiles: count(),
    })
    .from(schema.agentProfileToolServer)
    .where(inArray(schema.agentProfileToolServer.toolServerId, serverIds))
    .groupBy(schema.agentProfileToolServer.toolServerId)
  return new Map(rows.map((r) => [r.toolServerId, r.profiles]))
}

// Final request headers for a handshake: secret placeholders substituted.
function renderedHeaders(
  headers: Record<string, string>,
  secrets: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, template] of Object.entries(headers)) {
    out[name] = renderTemplate(template, "header", {}, secrets)
  }
  return out
}

export const listToolServers: AppRouteHandler<ListToolServersRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const rows = await db
    .select()
    .from(schema.toolServer)
    .where(eq(schema.toolServer.workspaceId, workspace.id))
    .orderBy(desc(schema.toolServer.createdAt))
  const counts = await grantCounts(rows.map((r) => r.id))
  return c.json(
    { servers: rows.map((r) => toResponse(r, counts.get(r.id) ?? 0)) },
    HttpStatusCodes.OK
  )
}

export const createToolServer: AppRouteHandler<CreateToolServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      {
        success: false,
        message:
          "Tool servers require INTEGRATION_ENCRYPTION_KEY to be configured",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const urlIssue = customToolUrlIssue(body.url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const secrets = Object.fromEntries(
    Object.entries(body.secrets).map(([name, value]) => [
      name,
      encryptSecret(value, key),
    ])
  )

  const row = await db
    .insert(schema.toolServer)
    .values({
      workspaceId: workspace.id,
      createdBy: c.var.user.id,
      name: body.name,
      description: body.description,
      url: body.url,
      headers: body.headers,
      secrets,
      enabledTools: body.enabledTools,
    })
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict" || !row) {
    return c.json(
      { success: false, message: "A server with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ server: toResponse(row, 0) }, HttpStatusCodes.OK)
}

export const updateToolServer: AppRouteHandler<UpdateToolServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { serverId } = c.req.valid("param")
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "Tool servers are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (body.url !== undefined) {
    const urlIssue = customToolUrlIssue(body.url)
    if (urlIssue) {
      return c.json(
        { success: false, message: urlIssue },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const existing = await db
    .select()
    .from(schema.toolServer)
    .where(
      and(
        eq(schema.toolServer.id, serverId),
        eq(schema.toolServer.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!existing) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Merge semantics: string sets (encrypted), null deletes, absent keeps.
  let secrets: Record<string, string> | undefined
  if (body.secrets !== undefined) {
    // Count the merged set before encrypting — a patch isn't size-capped by
    // the schema (null deletes need to pass through), so an oversized body
    // would otherwise buy N encryptions before the rejection.
    const merged = new Set(Object.keys(existing.secrets))
    for (const [name, value] of Object.entries(body.secrets)) {
      if (value === null) merged.delete(name)
      else merged.add(name)
    }
    if (merged.size > 20) {
      return c.json(
        { success: false, message: "At most 20 secrets" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    secrets = { ...existing.secrets }
    for (const [name, value] of Object.entries(body.secrets)) {
      if (value === null) delete secrets[name]
      else secrets[name] = encryptSecret(value, key)
    }
  }

  const row = await db
    .update(schema.toolServer)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.headers !== undefined ? { headers: body.headers } : {}),
      ...(body.enabledTools !== undefined
        ? { enabledTools: body.enabledTools }
        : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    })
    .where(eq(schema.toolServer.id, existing.id))
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict") {
    return c.json(
      { success: false, message: "A server with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (!row) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const counts = await grantCounts([row.id])
  return c.json(
    { server: toResponse(row, counts.get(row.id) ?? 0) },
    HttpStatusCodes.OK
  )
}

export const deleteToolServer: AppRouteHandler<DeleteToolServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { serverId } = c.req.valid("param")

  // Profile grants cascade away (agent_profile_tool_server FK).
  const row = await db
    .delete(schema.toolServer)
    .where(
      and(
        eq(schema.toolServer.id, serverId),
        eq(schema.toolServer.workspaceId, workspace.id)
      )
    )
    .returning({ id: schema.toolServer.id })
    .then((rows) => rows[0])
  if (!row) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const discoverToolServer: AppRouteHandler<
  DiscoverToolServerRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const body = c.req.valid("json")

  const urlIssue = customToolUrlIssue(body.url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const result = await discoverMcp({
    url: body.url,
    headers: renderedHeaders(body.headers, body.secrets),
  })
  if ("error" in result) {
    return c.json(
      { success: false, message: result.error },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ tools: result.tools }, HttpStatusCodes.OK)
}

export const rediscoverToolServer: AppRouteHandler<
  RediscoverToolServerRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { serverId } = c.req.valid("param")
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "Tool servers are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const existing = await db
    .select()
    .from(schema.toolServer)
    .where(
      and(
        eq(schema.toolServer.id, serverId),
        eq(schema.toolServer.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!existing) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const url = body.url ?? existing.url
  const urlIssue = customToolUrlIssue(url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // Stored secrets decrypted, unsaved plaintext ones overlaid on top. Write-
  // only secrets must never leave for a host the workspace didn't save them
  // against, so a url override tests with the request's own secrets only.
  const secrets: Record<string, string> = {}
  if (url === existing.url) {
    for (const [name, ciphertext] of Object.entries(existing.secrets)) {
      try {
        secrets[name] = decryptSecret(ciphertext, key)
      } catch {
        // An undecryptable secret renders as empty; the handshake will fail
        // with the server's own auth error, which is more actionable.
      }
    }
  }
  Object.assign(secrets, body.secrets)

  const result = await discoverMcp({
    url,
    headers: renderedHeaders(body.headers ?? existing.headers, secrets),
  })
  if ("error" in result) {
    return c.json(
      { success: false, message: result.error },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ tools: result.tools }, HttpStatusCodes.OK)
}
