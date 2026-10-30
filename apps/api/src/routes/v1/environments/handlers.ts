import { and, db, eq, inArray, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { isSafeEnvFileName } from "@repo/lor/dev-env/environments"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetEnvironmentRoute,
  RevealEnvironmentRoute,
  SaveEnvironmentRoute,
} from "@/routes/v1/environments/routes"

// Repo environments for code sessions (reference/dev-environment-runbook.md
// §2). Every member reads the keys; environment:manage edits and reveals.

async function findEnvironment(workspaceId: string, repoFullName: string) {
  const [row] = await db
    .select({
      id: schema.environment.id,
      fileName: schema.environment.fileName,
      updatedAt: schema.environment.updatedAt,
      updatedByName: schema.user.name,
    })
    .from(schema.environment)
    .leftJoin(schema.user, eq(schema.environment.updatedById, schema.user.id))
    .where(
      and(
        eq(schema.environment.workspaceId, workspaceId),
        eq(schema.environment.repoFullName, repoFullName)
      )
    )
    .limit(1)
  return row ?? null
}

async function environmentResponse(
  workspaceId: string,
  repoFullName: string,
  canManage: boolean
) {
  const found = await findEnvironment(workspaceId, repoFullName)
  const variables = found
    ? await db
        .select({ key: schema.environmentVariable.key })
        .from(schema.environmentVariable)
        .where(eq(schema.environmentVariable.environmentId, found.id))
        .orderBy(schema.environmentVariable.key)
    : []
  return {
    environment: found
      ? {
          fileName: found.fileName,
          updatedAt: found.updatedAt.toISOString(),
          updatedByName: found.updatedByName,
        }
      : null,
    variables,
    canManage,
  }
}

export const getEnvironment: AppRouteHandler<GetEnvironmentRoute> = async (
  c
) => {
  const { owner, repo } = c.req.valid("param")
  const canManage = hasWorkspaceAuthority(c.var.authority, {
    environment: ["manage"],
  })
  return c.json(
    await environmentResponse(
      c.var.workspace.id,
      `${owner}/${repo}`,
      canManage
    ),
    HttpStatusCodes.OK
  )
}

export const saveEnvironment: AppRouteHandler<SaveEnvironmentRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const workspaceId = c.var.workspace.id
  const { owner, repo } = c.req.valid("param")
  const { fileName, variables } = c.req.valid("json")
  const repoFullName = `${owner}/${repo}`
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      {
        success: false,
        message: "Environments are unavailable on this server",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (!isSafeEnvFileName(fileName)) {
    return c.json(
      {
        success: false,
        message: "The file name must be a path inside the repo",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (new Set(variables.map((v) => v.key)).size !== variables.length) {
    return c.json(
      { success: false, message: "Each key can appear once" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const missing = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(schema.environment)
      .values({
        workspaceId,
        repoFullName,
        fileName,
        updatedById: c.var.user.id,
      })
      .onConflictDoUpdate({
        target: [
          schema.environment.workspaceId,
          schema.environment.repoFullName,
        ],
        set: { fileName, updatedById: c.var.user.id, updatedAt: new Date() },
      })
      .returning({ id: schema.environment.id })
    if (!saved) throw new Error("Environment upsert returned no row")
    const existing = await tx
      .select({ key: schema.environmentVariable.key })
      .from(schema.environmentVariable)
      .where(eq(schema.environmentVariable.environmentId, saved.id))
    const known = new Set(existing.map((row) => row.key))
    // A new key needs a value; an existing one keeps its value when omitted.
    const unset = variables.filter(
      (v) => v.value === undefined && !known.has(v.key)
    )
    if (unset.length > 0) return unset.map((v) => v.key)

    const keep = new Set(variables.map((v) => v.key))
    const removed = [...known].filter((k) => !keep.has(k))
    if (removed.length > 0) {
      await tx
        .delete(schema.environmentVariable)
        .where(
          and(
            eq(schema.environmentVariable.environmentId, saved.id),
            inArray(schema.environmentVariable.key, removed)
          )
        )
    }
    for (const variable of variables) {
      if (variable.value === undefined) continue
      const value = encryptSecret(variable.value, key)
      await tx
        .insert(schema.environmentVariable)
        .values({ environmentId: saved.id, key: variable.key, value })
        .onConflictDoUpdate({
          target: [
            schema.environmentVariable.environmentId,
            schema.environmentVariable.key,
          ],
          set: { value },
        })
    }
    return []
  })
  if (missing.length > 0) {
    return c.json(
      { success: false, message: `Add a value for ${missing.join(", ")}` },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json(
    await environmentResponse(workspaceId, repoFullName, true),
    HttpStatusCodes.OK
  )
}

export const revealEnvironment: AppRouteHandler<
  RevealEnvironmentRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const { owner, repo } = c.req.valid("param")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  const found = await findEnvironment(c.var.workspace.id, `${owner}/${repo}`)
  if (!found || !key) {
    return c.json({ variables: [] }, HttpStatusCodes.OK)
  }
  const rows = await db
    .select({
      key: schema.environmentVariable.key,
      value: schema.environmentVariable.value,
    })
    .from(schema.environmentVariable)
    .where(eq(schema.environmentVariable.environmentId, found.id))
    .orderBy(schema.environmentVariable.key)
  return c.json(
    {
      variables: rows.map((row) => ({
        key: row.key,
        value: decryptSecret(row.value, key),
      })),
    },
    HttpStatusCodes.OK
  )
}
