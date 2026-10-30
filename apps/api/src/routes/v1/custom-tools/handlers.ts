import { profileSelectedTools } from "@repo/connectors"
import { and, db, desc, eq, isUniqueViolation, schema } from "@repo/db"
import type { CustomTool } from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  bodyMustBeJson,
  bodyTemplateJsonIssue,
  customToolUrlIssue,
  RESERVED_TOOL_NAMES,
} from "@repo/lor/custom-tools"
import { encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateCustomToolRoute,
  DeleteCustomToolRoute,
  ListCustomToolsRoute,
  UpdateCustomToolRoute,
} from "@/routes/v1/custom-tools/routes"

// Templates may embed literal credentials typed instead of {{secrets.*}}
// references. Members without customTool:manage see placeholders as-is and
// every other literal value (header, query value, body string) masked.
const MASK = "••••••"
const PLACEHOLDER_REGEX = /\{\{[^}]*\}\}/g
const JSON_STRING_REGEX = /"((?:[^"\\]|\\.)*)"(\s*:)?/g

function placeholderOnly(value: string): boolean {
  return value.replace(PLACEHOLDER_REGEX, "").trim() === ""
}

function redactedHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      placeholderOnly(value) ? value : MASK,
    ])
  )
}

function redactedUrlTemplate(template: string): string {
  const queryStart = template.indexOf("?")
  if (queryStart === -1) return template
  const hashStart = template.indexOf("#", queryStart)
  const queryEnd = hashStart === -1 ? template.length : hashStart
  const query = template
    .slice(queryStart + 1, queryEnd)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=")
      if (eq === -1 || placeholderOnly(pair.slice(eq + 1))) return pair
      return `${pair.slice(0, eq)}=${MASK}`
    })
    .join("&")
  return `${template.slice(0, queryStart + 1)}${query}${template.slice(queryEnd)}`
}

function redactedBodyTemplate(body: string | null): string | null {
  if (body === null || placeholderOnly(body)) return body
  if (bodyTemplateJsonIssue(body) !== null) return MASK
  return body.replace(JSON_STRING_REGEX, (match, inner: string, colon) =>
    colon || placeholderOnly(inner) ? match : `"${MASK}"`
  )
}

// Secret values are write-only: stored encrypted, surfaced as names only.
function toResponse(row: CustomTool, usedByProfiles: number, reveal = true) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    argsSchema: row.argsSchema,
    method: row.method,
    urlTemplate: reveal
      ? row.urlTemplate
      : redactedUrlTemplate(row.urlTemplate),
    headers: reveal ? row.headers : redactedHeaders(row.headers),
    bodyTemplate: reveal
      ? row.bodyTemplate
      : redactedBodyTemplate(row.bodyTemplate),
    secretNames: Object.keys(row.secrets),
    usedByProfiles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// Profiles whose toolAccess grants each tool, including ones that follow all
// workspace API tools.
async function grantCounts(
  workspaceId: string,
  toolIds: string[]
): Promise<Map<string, number>> {
  if (toolIds.length === 0) return new Map()
  const profiles = await db
    .select({ access: schema.agentProfile.toolAccess })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.workspaceId, workspaceId))
  return new Map(
    toolIds.map((id) => [
      id,
      profiles.filter(
        (profile) =>
          profileSelectedTools([id], profile.access.customTools).length > 0
      ).length,
    ])
  )
}

// The template must already be a valid https URL to a public host; hosts can
// never come from args/secrets (placeholders fail hostname validation). The
// lor executor re-checks the final URL at call time.
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
  const counts = await grantCounts(
    workspace.id,
    rows.map((r) => r.id)
  )
  const reveal = hasWorkspaceAuthority(c.var.authority, {
    customTool: ["manage"],
  })
  return c.json(
    {
      tools: rows.map((r) => toResponse(r, counts.get(r.id) ?? 0, reveal)),
    },
    HttpStatusCodes.OK
  )
}

export const createCustomTool: AppRouteHandler<CreateCustomToolRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  const endpointChanged =
    body.urlTemplate !== undefined && body.urlTemplate !== existing.urlTemplate
  const effectiveBody =
    body.bodyTemplate !== undefined ? body.bodyTemplate : existing.bodyTemplate
  const effectiveHeaders =
    body.headers ?? (endpointChanged ? {} : existing.headers)
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

  // Changing the endpoint must never forward previously stored credentials.
  let secrets: Record<string, string> | undefined = endpointChanged
    ? {}
    : undefined
  if (body.secrets !== undefined) {
    secrets = endpointChanged ? {} : { ...existing.secrets }
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
      ...(body.headers !== undefined
        ? { headers: body.headers }
        : endpointChanged
          ? { headers: {} }
          : {}),
      ...(body.bodyTemplate !== undefined
        ? { bodyTemplate: body.bodyTemplate }
        : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    })
    .where(
      and(
        eq(schema.customTool.id, existing.id),
        eq(schema.customTool.urlTemplate, existing.urlTemplate),
        eq(schema.customTool.headers, existing.headers),
        eq(schema.customTool.secrets, existing.secrets)
      )
    )
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
  const counts = await grantCounts(workspace.id, [row.id])
  return c.json(
    { tool: toResponse(row, counts.get(row.id) ?? 0) },
    HttpStatusCodes.OK
  )
}

export const deleteCustomTool: AppRouteHandler<DeleteCustomToolRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
  const { toolId } = c.req.valid("param")

  // Profiles that listed it show it as unavailable until an admin removes it.
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
