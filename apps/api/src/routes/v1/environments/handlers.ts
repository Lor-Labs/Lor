import { and, db, desc, eq, inArray, isUniqueViolation, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  encodeEnvValue,
  isSafeEnvFilePath,
} from "@repo/lor/dev-env/environments"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateEnvironmentRoute,
  DeleteEnvironmentRoute,
  ListEnvironmentsRoute,
  RevealEnvironmentRoute,
  UpdateEnvironmentRoute,
} from "@/routes/v1/environments/routes"

// Environments for code sessions (reference/dev-environment-runbook.md §2).
// Every member reads names, files and keys; environment:manage creates,
// edits, reveals and deletes.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type FileInput = {
  id?: string
  path: string
  variables: { key: string; value?: string }[]
}

// A refused save, rolled back and returned as a 400.
class EnvironmentInputError extends Error {}

function checkFiles(files: FileInput[]) {
  const paths = new Set<string>()
  for (const file of files) {
    if (!isSafeEnvFilePath(file.path)) {
      throw new EnvironmentInputError(
        `"${file.path}" must be a path inside the repo`
      )
    }
    if (paths.has(file.path)) {
      throw new EnvironmentInputError(`"${file.path}" appears twice`)
    }
    paths.add(file.path)
    const keys = file.variables.map((v) => v.key)
    if (new Set(keys).size !== keys.length) {
      throw new EnvironmentInputError(`A key appears twice in ${file.path}`)
    }
    const unwritable = file.variables.find(
      (v) => v.value !== undefined && encodeEnvValue(v.value) === null
    )
    if (unwritable) {
      throw new EnvironmentInputError(
        `${unwritable.key} can't be written to an env file exactly. It can't end in a backslash, and a value with a $ or a line break can't also contain " or \\n.`
      )
    }
  }
}

async function environmentRows(
  workspaceId: string,
  filter: { repo?: string; id?: string }
) {
  const envs = await db
    .select({
      id: schema.environment.id,
      name: schema.environment.name,
      updatedAt: schema.environment.updatedAt,
      updatedByName: schema.user.name,
    })
    .from(schema.environment)
    .leftJoin(schema.user, eq(schema.environment.updatedById, schema.user.id))
    .where(
      and(
        eq(schema.environment.workspaceId, workspaceId),
        filter.id ? eq(schema.environment.id, filter.id) : undefined,
        filter.repo
          ? inArray(
              schema.environment.id,
              db
                .select({ id: schema.environmentRepo.environmentId })
                .from(schema.environmentRepo)
                .where(eq(schema.environmentRepo.repoFullName, filter.repo))
            )
          : undefined
      )
    )
    .orderBy(desc(schema.environment.updatedAt))
  if (envs.length === 0) return []
  const repos = await db
    .select()
    .from(schema.environmentRepo)
    .where(
      inArray(
        schema.environmentRepo.environmentId,
        envs.map((e) => e.id)
      )
    )
  const files = repos.length
    ? await db
        .select()
        .from(schema.environmentFile)
        .where(
          inArray(
            schema.environmentFile.environmentRepoId,
            repos.map((r) => r.id)
          )
        )
        .orderBy(schema.environmentFile.path)
    : []
  const keys = files.length
    ? await db
        .select({
          fileId: schema.environmentVariable.environmentFileId,
          key: schema.environmentVariable.key,
        })
        .from(schema.environmentVariable)
        .where(
          inArray(
            schema.environmentVariable.environmentFileId,
            files.map((f) => f.id)
          )
        )
        .orderBy(schema.environmentVariable.key)
    : []
  return envs.map((e) => ({
    id: e.id,
    name: e.name,
    updatedAt: e.updatedAt.toISOString(),
    updatedByName: e.updatedByName,
    repos: repos
      .filter((r) => r.environmentId === e.id)
      .map((r) => ({
        repoFullName: r.repoFullName,
        files: files
          .filter((f) => f.environmentRepoId === r.id)
          .map((f) => ({
            id: f.id,
            path: f.path,
            keys: keys.filter((k) => k.fileId === f.id).map((k) => k.key),
          })),
      })),
  }))
}

// Replaces the repo's file list. Files and keys left out are deleted; a
// variable without a value keeps its saved one.
async function saveFiles(
  tx: Tx,
  environmentRepoId: string,
  files: FileInput[],
  key: string
) {
  const existing = await tx
    .select({ id: schema.environmentFile.id })
    .from(schema.environmentFile)
    .where(eq(schema.environmentFile.environmentRepoId, environmentRepoId))
  const existingIds = new Set(existing.map((f) => f.id))
  for (const file of files) {
    if (file.id && !existingIds.has(file.id)) {
      throw new EnvironmentInputError("A file no longer exists; reload")
    }
  }
  const kept = new Set(files.flatMap((f) => (f.id ? [f.id] : [])))
  const removed = [...existingIds].filter((id) => !kept.has(id))
  if (removed.length > 0) {
    await tx
      .delete(schema.environmentFile)
      .where(inArray(schema.environmentFile.id, removed))
  }

  for (const file of files) {
    let fileId = file.id
    if (fileId) {
      await tx
        .update(schema.environmentFile)
        .set({ path: file.path })
        .where(eq(schema.environmentFile.id, fileId))
    } else {
      const [created] = await tx
        .insert(schema.environmentFile)
        .values({ environmentRepoId, path: file.path })
        .returning({ id: schema.environmentFile.id })
      fileId = created?.id
    }
    if (!fileId) throw new Error("Environment file insert returned no row")

    const savedKeys = new Set(
      (
        await tx
          .select({ key: schema.environmentVariable.key })
          .from(schema.environmentVariable)
          .where(eq(schema.environmentVariable.environmentFileId, fileId))
      ).map((row) => row.key)
    )
    const unset = file.variables.filter(
      (v) => v.value === undefined && !savedKeys.has(v.key)
    )
    if (unset.length > 0) {
      throw new EnvironmentInputError(
        `Add a value for ${unset.map((v) => v.key).join(", ")} in ${file.path}`
      )
    }
    const keep = new Set(file.variables.map((v) => v.key))
    const dropped = [...savedKeys].filter((k) => !keep.has(k))
    if (dropped.length > 0) {
      await tx
        .delete(schema.environmentVariable)
        .where(
          and(
            eq(schema.environmentVariable.environmentFileId, fileId),
            inArray(schema.environmentVariable.key, dropped)
          )
        )
    }
    for (const variable of file.variables) {
      if (variable.value === undefined) continue
      const value = encryptSecret(variable.value, key)
      await tx
        .insert(schema.environmentVariable)
        .values({ environmentFileId: fileId, key: variable.key, value })
        .onConflictDoUpdate({
          target: [
            schema.environmentVariable.environmentFileId,
            schema.environmentVariable.key,
          ],
          set: { value },
        })
    }
  }
}

const unavailable = {
  success: false as const,
  message: "Environments are unavailable on this server",
}
const nameTaken = {
  success: false as const,
  message: "An environment with that name exists",
}

export const listEnvironments: AppRouteHandler<ListEnvironmentsRoute> = async (
  c
) => {
  const { repo } = c.req.valid("query")
  return c.json(
    {
      environments: await environmentRows(c.var.workspace.id, { repo }),
      canManage: hasWorkspaceAuthority(c.var.authority, {
        environment: ["manage"],
      }),
    },
    HttpStatusCodes.OK
  )
}

export const createEnvironment: AppRouteHandler<
  CreateEnvironmentRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const workspaceId = c.var.workspace.id
  const body = c.req.valid("json")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return c.json(unavailable, HttpStatusCodes.BAD_REQUEST)
  try {
    checkFiles(body.files)
    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.environment)
        .values({
          workspaceId,
          name: body.name,
          createdById: c.var.user.id,
          updatedById: c.var.user.id,
        })
        .returning({ id: schema.environment.id })
      if (!created) throw new Error("Environment insert returned no row")
      const [repo] = await tx
        .insert(schema.environmentRepo)
        .values({ environmentId: created.id, repoFullName: body.repo })
        .returning({ id: schema.environmentRepo.id })
      if (!repo) throw new Error("Environment repo insert returned no row")
      await saveFiles(tx, repo.id, body.files, key)
      return created.id
    })
    const [environment] = await environmentRows(workspaceId, { id })
    if (!environment) throw new Error("Created environment not found")
    return c.json({ environment }, HttpStatusCodes.OK)
  } catch (err) {
    if (err instanceof EnvironmentInputError) {
      return c.json(
        { success: false, message: err.message },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    if (isUniqueViolation(err)) {
      return c.json(nameTaken, HttpStatusCodes.CONFLICT)
    }
    throw err
  }
}

export const updateEnvironment: AppRouteHandler<
  UpdateEnvironmentRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const workspaceId = c.var.workspace.id
  const { environmentId } = c.req.valid("param")
  const body = c.req.valid("json")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return c.json(unavailable, HttpStatusCodes.BAD_REQUEST)
  try {
    checkFiles(body.files)
    const found = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.environment)
        .set({ name: body.name, updatedById: c.var.user.id })
        .where(
          and(
            eq(schema.environment.id, environmentId),
            eq(schema.environment.workspaceId, workspaceId)
          )
        )
        .returning({ id: schema.environment.id })
      if (!updated) return false
      // One repo per environment for now.
      const [repo] = await tx
        .select({ id: schema.environmentRepo.id })
        .from(schema.environmentRepo)
        .where(eq(schema.environmentRepo.environmentId, environmentId))
        .limit(1)
      if (!repo) throw new EnvironmentInputError("The environment has no repo")
      await saveFiles(tx, repo.id, body.files, key)
      return true
    })
    if (!found) {
      return c.json(
        { success: false, message: "Environment not found" },
        HttpStatusCodes.NOT_FOUND
      )
    }
    const [environment] = await environmentRows(workspaceId, {
      id: environmentId,
    })
    if (!environment) throw new Error("Updated environment not found")
    return c.json({ environment }, HttpStatusCodes.OK)
  } catch (err) {
    if (err instanceof EnvironmentInputError) {
      return c.json(
        { success: false, message: err.message },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    if (isUniqueViolation(err)) {
      return c.json(nameTaken, HttpStatusCodes.CONFLICT)
    }
    throw err
  }
}

export const revealEnvironment: AppRouteHandler<
  RevealEnvironmentRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const { environmentId } = c.req.valid("param")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  const files = await db
    .select({
      id: schema.environmentFile.id,
      path: schema.environmentFile.path,
    })
    .from(schema.environmentFile)
    .innerJoin(
      schema.environmentRepo,
      eq(schema.environmentRepo.id, schema.environmentFile.environmentRepoId)
    )
    .innerJoin(
      schema.environment,
      eq(schema.environment.id, schema.environmentRepo.environmentId)
    )
    .where(
      and(
        eq(schema.environment.id, environmentId),
        eq(schema.environment.workspaceId, c.var.workspace.id)
      )
    )
    .orderBy(schema.environmentFile.path)
  if (!key || files.length === 0) {
    return c.json({ files: [] }, HttpStatusCodes.OK)
  }
  const vars = await db
    .select({
      fileId: schema.environmentVariable.environmentFileId,
      key: schema.environmentVariable.key,
      value: schema.environmentVariable.value,
    })
    .from(schema.environmentVariable)
    .where(
      inArray(
        schema.environmentVariable.environmentFileId,
        files.map((f) => f.id)
      )
    )
    .orderBy(schema.environmentVariable.key)
  return c.json(
    {
      files: files.map((file) => ({
        id: file.id,
        path: file.path,
        variables: vars
          .filter((v) => v.fileId === file.id)
          .map((v) => ({ key: v.key, value: decryptSecret(v.value, key) })),
      })),
    },
    HttpStatusCodes.OK
  )
}

export const deleteEnvironment: AppRouteHandler<
  DeleteEnvironmentRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { environment: ["manage"] })
  const { environmentId } = c.req.valid("param")
  const deleted = await db
    .delete(schema.environment)
    .where(
      and(
        eq(schema.environment.id, environmentId),
        eq(schema.environment.workspaceId, c.var.workspace.id)
      )
    )
    .returning({ id: schema.environment.id })
  if (deleted.length === 0) {
    return c.json(
      { success: false, message: "Environment not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
