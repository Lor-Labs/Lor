import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { logger } from "../logger"

// A repo's environment, written into the code session's work folder each
// turn (reference/dev-environment-runbook.md §2). Proxy-delivered variables
// never reach the file.

const HEADER =
  "# Written by Lor from this repo's environment. Edit it in Lor: changes here are replaced on Lor's next turn."

// A relative path inside the repo: no absolute paths, no `..`.
export function isSafeEnvFileName(name: string): boolean {
  if (!name || name.length > 200 || name.startsWith("/")) return false
  return name.split("/").every((part) => part !== "" && part !== "..")
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

export async function loadEnvironment(
  workspaceId: string,
  repoFullName: string
) {
  const [row] = await db
    .select()
    .from(schema.environment)
    .where(
      and(
        eq(schema.environment.workspaceId, workspaceId),
        eq(schema.environment.repoFullName, repoFullName)
      )
    )
    .limit(1)
  return row ?? null
}

// Decrypted file-delivered variables, in key order.
async function fileVariables(environmentId: string) {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return []
  const rows = await db
    .select({
      key: schema.environmentVariable.key,
      value: schema.environmentVariable.value,
    })
    .from(schema.environmentVariable)
    .where(
      and(
        eq(schema.environmentVariable.environmentId, environmentId),
        eq(schema.environmentVariable.delivery, "file")
      )
    )
    .orderBy(schema.environmentVariable.key)
  return rows.map((row) => ({
    key: row.key,
    value: decryptSecret(row.value, key),
  }))
}

// Writes the env file and lists it in .git/info/exclude, so it is never
// committed even when the repo does not ignore it. Nothing is written (and a
// file a person made is left alone) when the repo has no environment.
export async function writeEnvironmentFile(input: {
  sandbox: SandboxSession
  workDir: string
  workspaceId: string
  repoFullName: string
}): Promise<boolean> {
  const environment = await loadEnvironment(
    input.workspaceId,
    input.repoFullName
  )
  if (!environment || !isSafeEnvFileName(environment.fileName)) return false
  const vars = await fileVariables(environment.id)
  await input.sandbox.writeTextFile({
    path: posix.join(input.workDir, environment.fileName),
    content: renderEnvFile(vars),
  })
  const q = shellQuote
  const line = `/${environment.fileName}`
  const excluded = await input.sandbox.run({
    command: `cd ${q(input.workDir)} && mkdir -p .git/info && { grep -qxF ${q(line)} .git/info/exclude 2>/dev/null || echo ${q(line)} >> .git/info/exclude; }`,
  })
  if (excluded.exitCode !== 0) {
    logger.warn(
      { repo: input.repoFullName, stderr: excluded.stderr.slice(0, 300) },
      "Environment file: git exclude failed"
    )
  }
  return true
}
