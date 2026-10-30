import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { and, db, eq, inArray, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { logger } from "../logger"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { sessionWorkDir } from "./work-dir"

// A code session's environment, written into its work folder each turn
// (reference/dev-environment-runbook.md §2): every env file the environment
// keeps for the session's repo. Proxy-delivered variables never reach a file.

const HEADER =
  "# Written by Lor from this session's environment. Edit it in Lor: changes here are replaced on Lor's next turn."

// A relative path inside the repo: no absolute paths, no `..`.
export function isSafeEnvFilePath(path: string): boolean {
  if (!path || path.length > 200 || path.startsWith("/")) return false
  return path.split("/").every((part) => part !== "" && part !== "..")
}

// Double-quoted dotenv values: dotenv and dotenv-expand (Next, Vite) read
// \n and \" escapes, and `\$` stops variable expansion.
function quote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\r?\n/g, "\\n")}"`
}

export function renderEnvFile(vars: { key: string; value: string }[]): string {
  return `${[HEADER, ...vars.map((v) => `${v.key}=${quote(v.value)}`)].join("\n")}\n`
}

// The environment's id when it is the workspace's and includes the repo.
export async function environmentForRepo(
  workspaceId: string,
  environmentId: string,
  repoFullName: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.environment.id })
    .from(schema.environment)
    .innerJoin(
      schema.environmentRepo,
      eq(schema.environmentRepo.environmentId, schema.environment.id)
    )
    .where(
      and(
        eq(schema.environment.id, environmentId),
        eq(schema.environment.workspaceId, workspaceId),
        eq(schema.environmentRepo.repoFullName, repoFullName)
      )
    )
    .limit(1)
  return row?.id ?? null
}

// The repo's env files in the environment, with decrypted file-delivered
// variables in key order.
async function repoFiles(environmentId: string, repoFullName: string) {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return []
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
    .where(
      and(
        eq(schema.environmentRepo.environmentId, environmentId),
        eq(schema.environmentRepo.repoFullName, repoFullName)
      )
    )
  if (files.length === 0) return []
  const vars = await db
    .select({
      fileId: schema.environmentVariable.environmentFileId,
      key: schema.environmentVariable.key,
      value: schema.environmentVariable.value,
    })
    .from(schema.environmentVariable)
    .where(
      and(
        inArray(
          schema.environmentVariable.environmentFileId,
          files.map((file) => file.id)
        ),
        eq(schema.environmentVariable.delivery, "file")
      )
    )
    .orderBy(schema.environmentVariable.key)
  return files.map((file) => ({
    path: file.path,
    vars: vars
      .filter((v) => v.fileId === file.id)
      .map((v) => ({ key: v.key, value: decryptSecret(v.value, key) })),
  }))
}

// Writes each env file and lists it in .git/info/exclude, so none is ever
// committed even when the repo does not ignore it.
export async function writeEnvironmentFiles(input: {
  sandbox: SandboxSession
  workDir: string
  environmentId: string
  repoFullName: string
}): Promise<number> {
  const files = (
    await repoFiles(input.environmentId, input.repoFullName)
  ).filter((file) => isSafeEnvFilePath(file.path))
  if (files.length === 0) return 0
  for (const file of files) {
    await input.sandbox.writeTextFile({
      path: posix.join(input.workDir, file.path),
      content: renderEnvFile(file.vars),
    })
  }
  const q = shellQuote
  const lines = files.map((file) => q(`/${file.path}`)).join(" ")
  const excluded = await input.sandbox.run({
    command: `cd ${q(input.workDir)} && mkdir -p .git/info && for line in ${lines}; do grep -qxF "$line" .git/info/exclude 2>/dev/null || echo "$line" >> .git/info/exclude; done`,
  })
  if (excluded.exitCode !== 0) {
    logger.warn(
      { repo: input.repoFullName, stderr: excluded.stderr.slice(0, 300) },
      "Environment files: git exclude failed"
    )
  }
  return files.length
}

// A saved edit written into an open session's sandbox at once, instead of on
// Lor's next turn. Never creates a sandbox; false when there is none or the
// repo is not cloned yet.
export async function applySessionEnvironment(input: {
  sessionId: string
  environmentId: string
  repoFullName: string
}): Promise<boolean> {
  const sandbox = await attachSessionSandbox({ sessionId: input.sessionId })
  if (!sandbox) return false
  try {
    const workDir = sessionWorkDir(input.sessionId)
    const cloned = await sandbox.session.run({
      command: `test -d ${shellQuote(posix.join(workDir, ".git"))}`,
    })
    if (cloned.exitCode !== 0) return false
    await writeEnvironmentFiles({
      sandbox: sandbox.session,
      workDir,
      environmentId: input.environmentId,
      repoFullName: input.repoFullName,
    })
    return true
  } finally {
    sandbox.close()
  }
}
