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

// A relative path inside the repo: no absolute paths, no `.`, `..` or `.git`.
// Plain characters only, so the path is also its own exact git exclude line
// (no glob characters, spaces or line breaks).
export function isSafeEnvFilePath(path: string): boolean {
  if (!path || path.length > 200 || path.startsWith("/")) return false
  return path
    .split("/")
    .every(
      (part) =>
        /^[A-Za-z0-9._@+-]+$/.test(part) &&
        part !== "." &&
        part !== ".." &&
        part !== ".git"
    )
}

// dotenv keeps single-, backtick- and double-quoted values literally, except
// that double quotes decode `\n` and `\r`; it unescapes nothing else, and it
// reads a raw carriage return as a newline. A value without `$` or line breaks
// takes `'`, then a backtick, then `"` (only without `\n`/`\r` text),
// whichever it doesn't contain. Otherwise double quotes: `\n` and `\r` for
// line breaks, and `\$` for the dev servers' dotenv-expand (Vite, Next), which reads it as a literal `$` (plain dotenv
// keeps the backslash). Null: no form reads back exactly. A trailing `\`
// reads as an escaped closing quote, so dotenv can run on into later lines.
export function encodeEnvValue(value: string): string | null {
  if (value.endsWith("\\")) return null
  const escapes = /\\[nr$]/.test(value)
  if (!/[$\r\n]/.test(value)) {
    const mark = ["'", "`", ...(escapes ? [] : ['"'])].find(
      (q) => !value.includes(q)
    )
    return mark ? `${mark}${value}${mark}` : null
  }
  if (value.includes('"') || escapes) return null
  return `"${value
    .replace(/\$/g, "\\$")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`
}

// Values encodeEnvValue refuses are left out (saves reject them).
export function renderEnvFile(vars: { key: string; value: string }[]): string {
  const lines = vars.flatMap((v) => {
    const encoded = encodeEnvValue(v.value)
    return encoded === null ? [] : [`${v.key}=${encoded}`]
  })
  return `${[HEADER, ...lines].join("\n")}\n`
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

// The env files Lor wrote last time, so a file removed from the environment
// is deleted. Inside .git, so it is never committed.
const MANIFEST = ".git/info/lor-env-files"

// Lists each env file in .git/info/exclude first and writes it only after,
// so none is ever committed even when the repo does not ignore it. A path git
// already tracks is skipped: excludes don't cover tracked files. Files from
// the last write that are gone from the environment are deleted when they
// still start with Lor's header.
export async function writeEnvironmentFiles(input: {
  sandbox: SandboxSession
  workDir: string
  environmentId: string
  repoFullName: string
}): Promise<number> {
  const q = shellQuote
  const cd = `cd ${q(input.workDir)}`
  let files = (await repoFiles(input.environmentId, input.repoFullName)).filter(
    (file) => isSafeEnvFilePath(file.path)
  )
  if (files.length > 0) {
    const listed = await input.sandbox.run({
      command: `${cd} && git ls-files -- ${files.map((f) => q(f.path)).join(" ")}`,
    })
    if (listed.exitCode !== 0) {
      throw new Error("Environment files: git ls-files failed")
    }
    const tracked = new Set(listed.stdout.split("\n").filter(Boolean))
    for (const path of tracked) {
      logger.warn(
        { repo: input.repoFullName, path },
        "Environment file is tracked by git; skipped"
      )
    }
    files = files.filter((file) => !tracked.has(file.path))
  }

  const paths = files.map((file) => q(file.path)).join(" ")
  const prepared = await input.sandbox.run({
    command: [
      `${cd} && mkdir -p .git/info || exit 1`,
      `set -- ${paths}`,
      // A repo .gitignore negation (`!.env.local`) beats info/exclude.
      `for p in "$@"; do grep -qxF "/$p" .git/info/exclude 2>/dev/null || echo "/$p" >> .git/info/exclude || exit 1; git check-ignore -q -- "$p" || { echo "git does not ignore $p" >&2; exit 1; }; done`,
      `printf '%s\\n' "$@" > ${MANIFEST}.next || exit 1`,
      // A stale file that can't be deleted stays listed for the next write.
      `if [ -f ${MANIFEST} ]; then while IFS= read -r old; do keep=; for p in "$@"; do [ "$p" = "$old" ] && keep=1; done; if [ -z "$keep" ] && [ -f "$old" ] && ! git ls-files --error-unmatch -- "$old" >/dev/null 2>&1 && head -n 1 -- "$old" | grep -qxF ${q(HEADER)}; then rm -f -- "$old" || printf '%s\\n' "$old" >> ${MANIFEST}.next; fi; done < ${MANIFEST}; fi`,
      `mv -f ${MANIFEST}.next ${MANIFEST}`,
    ].join("\n"),
  })
  if (prepared.exitCode !== 0) {
    logger.warn(
      { repo: input.repoFullName, stderr: prepared.stderr.slice(0, 300) },
      "Environment files: git exclude failed"
    )
    throw new Error("Environment files: git exclude failed")
  }
  for (const file of files) {
    await input.sandbox.writeTextFile({
      path: posix.join(input.workDir, file.path),
      content: renderEnvFile(file.vars),
    })
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
