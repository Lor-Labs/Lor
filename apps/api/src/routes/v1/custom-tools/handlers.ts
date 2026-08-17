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
import type { CustomTool } from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  bodyMustBeJson,
  bodyTemplateJsonIssue,
  customToolUrlIssue,
  RESERVED_TOOL_NAMES,
} from "@repo/merlin/custom-tools"
import { encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateCustomToolRoute,
  DeleteCustomToolRoute,
  ListCustomToolsRoute,
  UpdateCustomToolRoute,
} from "@/routes/v1/custom-tools/routes"

// Secret values are write-only: stored encrypted, surfaced as names only.
function toResponse(row: CustomTool, usedByProfiles: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    argsSchema: row.argsSchema,
    method: row.method,
    urlTemplate: row.urlTemplate,
    headers: row.headers,
    bodyTemplate: row.bodyTemplate,
    secretNames: Object.keys(row.secrets),
    usedByProfiles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// Explicit per-profile grant counts (the blanket capability isn't counted —
// it has no per-tool rows).
async function grantCounts(toolIds: string[]): Promise<Map<string, number>> {
  if (toolIds.length === 0) return new Map()
  const rows = await db
    .select({
      customToolId: schema.agentProfileCustomTool.customToolId,
      profiles: count(),
    })
    .from(schema.agentProfileCustomTool)
    .where(inArray(schema.agentProfileCustomTool.customToolId, toolIds))
    .groupBy(schema.agentProfileCustomTool.customToolId)
  return new Map(rows.map((r) => [r.customToolId, r.profiles]))
}

// The template must already be a valid https URL to a public host; hosts can
// never come from args/secrets (placeholders fail hostname validation). The
// merlin executor re-checks the final URL at call time.
function templateIssue(urlTemplate: string): string | null {
  return customToolUrlIssue(urlTemplate)
}

export const listCustomTools: AppRouteHandler<ListCustomToolsRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const rows = await db
    .select()
    .from(schema.customTool)
    .where(eq(schema.customTool.workspaceId, workspace.id))
    .orderBy(desc(schema.customTool.createdAt))
  const counts = await grantCounts(rows.map((r) => r.id))
  return c.json(
    { tools: rows.map((r) => toResponse(r, counts.get(r.id) ?? 0)) },
    HttpStatusCodes.OK
  )
}

export const createCustomTool: AppRouteHandler<CreateCustomToolRoute> = async (
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
          "Custom tools require INTEGRATION_ENCRYPTION_KEY to be configured",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (RESERVED_TOOL_NAMES.has(body.name)) {
    return c.json(
      { success: false, message: `"${body.name}" is a built-in tool name` },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const urlIssue = templateIssue(body.urlTemplate)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // JSON is the contract unless a non-JSON Content-Type header says otherwise.
  if (body.bodyTemplate && bodyMustBeJson(body.headers)) {
    const bodyIssue = bodyTemplateJsonIssue(body.bodyTemplate)
    if (bodyIssue) {
      return c.json(
        {
          success: false,
          message: `Body must be valid JSON (${bodyIssue}); set a non-JSON Content-Type header if your API expects another format`,
        },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const secrets = Object.fromEntries(
    Object.entries(body.secrets).map(([name, value]) => [
      name,
      encryptSecret(value, key),
    ])
  )

  const row = await db
    .insert(schema.customTool)
    .values({
      workspaceId: workspace.id,
      createdBy: c.var.user.id,
      name: body.name,
      description: body.description,
      argsSchema: body.argsSchema,
      method: body.method,
      urlTemplate: body.urlTemplate,
      headers: body.headers,
      bodyTemplate: body.bodyTemplate,
      secrets,
    })
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict" || !row) {
    return c.json(
      { success: false, message: "A tool with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ tool: toResponse(row, 0) }, HttpStatusCodes.OK)
}

export const updateCustomTool: AppRouteHandler<UpdateCustomToolRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { toolId } = c.req.valid("param")
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "Custom tools are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (body.name !== undefined && RESERVED_TOOL_NAMES.has(body.name)) {
    return c.json(
      { success: false, message: `"${body.name}" is a built-in tool name` },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (body.urlTemplate !== undefined) {
    const urlIssue = templateIssue(body.urlTemplate)
    if (urlIssue) {
      return c.json(
        { success: false, message: urlIssue },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const existing = await db
    .select()
    .from(schema.customTool)
    .where(
      and(
        eq(schema.customTool.id, toolId),
        eq(schema.customTool.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!existing) {
    return c.json(
      { success: false, message: "Tool not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Enforce the JSON contract on the EFFECTIVE post-patch body + headers
  // (either side may change independently).
  const effectiveBody =
    body.bodyTemplate !== undefined ? body.bodyTemplate : existing.bodyTemplate
  const effectiveHeaders =
    body.headers !== undefined ? body.headers : existing.headers
  if (effectiveBody && bodyMustBeJson(effectiveHeaders)) {
    const bodyIssue = bodyTemplateJsonIssue(effectiveBody)
    if (bodyIssue) {
      return c.json(
        {
          success: false,
          message: `Body must be valid JSON (${bodyIssue}); set a non-JSON Content-Type header if your API expects another format`,
        },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  // Merge semantics: string sets (encrypted), null deletes, absent keeps.
  let secrets: Record<string, string> | undefined
  if (body.secrets !== undefined) {
    secrets = { ...existing.secrets }
    for (const [name, value] of Object.entries(body.secrets)) {
      if (value === null) delete secrets[name]
      else secrets[name] = encryptSecret(value, key)
    }
    if (Object.keys(secrets).length > 20) {
      return c.json(
        { success: false, message: "At most 20 secrets" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const row = await db
    .update(schema.customTool)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.argsSchema !== undefined ? { argsSchema: body.argsSchema } : {}),
      ...(body.method !== undefined ? { method: body.method } : {}),
      ...(body.urlTemplate !== undefined
        ? { urlTemplate: body.urlTemplate }
        : {}),
      ...(body.headers !== undefined ? { headers: body.headers } : {}),
      ...(body.bodyTemplate !== undefined
        ? { bodyTemplate: body.bodyTemplate }
        : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    })
    .where(eq(schema.customTool.id, existing.id))
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict") {
    return c.json(
      { success: false, message: "A tool with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (!row) {
    return c.json(
      { success: false, message: "Tool not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const counts = await grantCounts([row.id])
  return c.json(
    { tool: toResponse(row, counts.get(row.id) ?? 0) },
    HttpStatusCodes.OK
  )
}

export const deleteCustomTool: AppRouteHandler<DeleteCustomToolRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { toolId } = c.req.valid("param")

  // Profile grants cascade away (agent_profile_custom_tool FK).
  const row = await db
    .delete(schema.customTool)
    .where(
      and(
        eq(schema.customTool.id, toolId),
        eq(schema.customTool.workspaceId, workspace.id)
      )
    )
    .returning({ id: schema.customTool.id })
    .then((rows) => rows[0])
  if (!row) {
    return c.json(
      { success: false, message: "Tool not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
