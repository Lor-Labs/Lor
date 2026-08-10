import { createHash, randomUUID } from "node:crypto"
import { env } from "@repo/env/server"
import { Sandbox } from "railway"
import { logger } from "../logger"
import { type Sandbox as SandboxInstance, withSandbox } from "./index"
import {
  buildPiCommand,
  buildPiModelConfig,
  WORKBENCH_PI_TOOLS,
} from "./pi-config"
import {
  createPiEventCollector,
  type PiCodeStep,
  type PiInvestigationUsage,
} from "./pi-events"

export type WorkbenchStep = PiCodeStep
export type WorkbenchUsage = PiInvestigationUsage

export type WorkbenchInput = {
  filename: string
  bytes: Uint8Array
}

export type WorkbenchFile = {
  // Relative to the output directory, e.g. "report.md" or "charts/q3.png".
  path: string
  bytes: Uint8Array
  contentType: string
}

export type WorkbenchResult = {
  files: WorkbenchFile[]
  summary: string
  // Absent when the session failed before pi reported usage.
  usage?: WorkbenchUsage
  // Output files dropped by the harvest caps, so the caller can say so.
  skipped: string[]
  // Name of the checkpoint saved after a task session (absent when saving
  // failed or the session wasn't task-scoped) — the caller persists it.
  checkpoint?: string
  // Set when the agent didn't finish cleanly (timeout, crash) but partial
  // work was still harvested/checkpointed — the caller tells the model so it
  // can continue instead of starting over.
  failure?: string
}

// Task continuity: boot from the task's last checkpoint (Pi's scripts,
// scratch state, and session file), reconcile /workspace/out with the current
// artifact versions, resume Pi's own conversation, and checkpoint again at
// the end.
export type WorkbenchTaskContinuity = {
  id: string
  bootCheckpoint: string | null
  outSeed: { path: string; bytes: Uint8Array }[]
}

const IN_DIR = "/workspace/in"
const OUT_DIR = "/workspace/out"
const BRIEF_FILE = "/workbench.txt"
const MAX_WALK_DEPTH = 4

// Workbench image = the base sandbox image (which ships pi, git, node — the
// bare Debian that templates build on can't run pi) + the Python toolchain,
// captured once as a named checkpoint. Sessions boot from the checkpoint in a
// few seconds. Bump the version suffix when changing the package set.
const WORKBENCH_CHECKPOINT = "workbench-base-v2"
const PROVISION_CMD =
  "apt-get update -qq && apt-get install -y -qq python3-pandas python3-matplotlib python3-openpyxl && pip install --break-system-packages --quiet pdfplumber"
const PROVISION_TIMEOUT_SEC = 420

// Checkpoint boots restore the disk but not the base image's PATH; pi and
// node live behind mise shims, so every command re-exports it.
const PATH_PREFIX = "PATH=/root/.local/bin:/root/.local/share/mise/shims:$PATH "

const SESSION_DIR = "/workspace/.pi-sessions"

async function resolveBootCheckpoint(
  taskCheckpoint: string | null
): Promise<string> {
  await ensureWorkbenchCheckpoint()
  if (!taskCheckpoint) return WORKBENCH_CHECKPOINT
  const list = await Sandbox.checkpoints().catch(() => [])
  if (list.some((c) => c.key === taskCheckpoint)) return taskCheckpoint
  logger.warn(
    { checkpoint: taskCheckpoint },
    "Workbench: task checkpoint missing; cold start"
  )
  return WORKBENCH_CHECKPOINT
}

// Best-effort removal of a superseded task checkpoint (delete is by id).
export async function deleteWorkbenchCheckpoint(name: string): Promise<void> {
  const list = await Sandbox.checkpoints().catch(() => [])
  const found = list.find((c) => c.key === name)
  if (!found) return
  await Sandbox.deleteCheckpoint(found.id).catch((err) => {
    logger.warn(
      { err, checkpoint: name },
      "Workbench: checkpoint delete failed"
    )
  })
}

// Single-flight: concurrent sessions await the one in-flight provisioning
// run instead of each booting a sandbox to build the same checkpoint.
let checkpointReady: Promise<void> | null = null
function ensureWorkbenchCheckpoint(): Promise<void> {
  checkpointReady ??= provisionWorkbenchCheckpoint().catch((err) => {
    checkpointReady = null
    throw err
  })
  return checkpointReady
}

async function provisionWorkbenchCheckpoint(): Promise<void> {
  const existing = await Sandbox.checkpoints().catch(() => [])
  if (existing.some((c) => c.key === WORKBENCH_CHECKPOINT)) return
  logger.info(
    { checkpoint: WORKBENCH_CHECKPOINT },
    "Workbench: provisioning checkpoint"
  )
  await withSandbox(async (sandbox) => {
    const r = await sandbox.exec(PROVISION_CMD, {
      timeoutSec: PROVISION_TIMEOUT_SEC,
    })
    if (r.exitCode !== 0) {
      throw new Error(
        `workbench provisioning failed: ${(r.stderr || r.stdout).slice(0, 300)}`
      )
    }
    // A concurrent worker may have saved the same name — that's a win, not
    // an error.
    await sandbox.checkpoint(WORKBENCH_CHECKPOINT).catch(async (err) => {
      const now = await Sandbox.checkpoints().catch(() => [])
      if (!now.some((c) => c.key === WORKBENCH_CHECKPOINT)) throw err
    })
  })
}

function brief(instructions: string, inputFilenames: string[]): string {
  const inputs = inputFilenames.length
    ? `Input files are in ${IN_DIR}:\n${inputFilenames.map((f) => `- ${IN_DIR}/${f}`).join("\n")}`
    : "There are no input files."
  return [
    "You are completing a work assignment in a clean Linux workspace.",
    "",
    inputs,
    "",
    `Write every deliverable file to ${OUT_DIR}. Everything in ${OUT_DIR} is`,
    "delivered to the team when you finish — and nothing else is. Keep scripts",
    "and scratch work elsewhere unless they are themselves deliverables.",
    "",
    "Python 3 is installed with pandas, matplotlib, openpyxl, and pdfplumber.",
    "Write and run scripts as needed.",
    "",
    "When you finish, reply with a short summary of what you produced and any",
    "assumptions you made.",
    "",
    `Assignment: ${instructions}`,
  ].join("\n")
}

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/plain",
  sql: "text/plain",
  patch: "text/x-diff",
  diff: "text/x-diff",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
}

export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return CONTENT_TYPES[ext] ?? "application/octet-stream"
}

function sanitizeFilename(filename: string): string {
  const base = filename.split("/").pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_")
}

async function walkOutputs(
  sandbox: SandboxInstance,
  dir: string,
  depth: number
): Promise<{ path: string; size: number }[]> {
  if (depth > MAX_WALK_DEPTH) return []
  const entries = await sandbox.files.list(dir).catch(() => [])
  const found: { path: string; size: number }[] = []
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`
    if (entry.isDir) {
      found.push(...(await walkOutputs(sandbox, full, depth + 1)))
    } else {
      found.push({ path: full, size: entry.size })
    }
  }
  return found
}

// One ephemeral workbench session: boot from the provisioned checkpoint, seed
// inputs, run the Pi coding agent with write tools, harvest the output
// directory, destroy the sandbox. Files live on only through what the caller
// persists.
export async function runWorkbenchSession(opts: {
  instructions: string
  inputs: WorkbenchInput[]
  timeoutSec: number
  abortSignal?: AbortSignal
  onStep?: (step: WorkbenchStep) => void
  task?: WorkbenchTaskContinuity
}): Promise<WorkbenchResult | { error: string }> {
  const { instructions, inputs, timeoutSec, abortSignal, onStep, task } = opts
  if (abortSignal?.aborted) return { error: "cancelled" }

  try {
    const bootFrom = await resolveBootCheckpoint(task?.bootCheckpoint ?? null)
    return await withSandbox(
      async (sandbox) => {
        await sandbox.exec(
          `mkdir -p ${IN_DIR} ${OUT_DIR} ${SESSION_DIR} /root/.pi/agent`,
          { timeoutSec: 30 }
        )

        // Reconcile the (possibly checkpoint-stale) output dir with the
        // current artifact versions — humans may have edited since. Digests
        // let the harvest skip files the agent didn't touch, so reseeding
        // never churns identical artifact versions.
        const digest = (bytes: Uint8Array) =>
          createHash("sha256").update(bytes).digest("hex")
        const seedDigests = new Map<string, string>()
        for (const seed of task?.outSeed ?? []) {
          // Artifact paths come from our own harvest, but never let one
          // escape the output dir.
          if (
            seed.path.startsWith("/") ||
            seed.path.split("/").includes("..")
          ) {
            logger.warn(
              { path: seed.path },
              "Workbench: skipped unsafe seed path"
            )
            continue
          }
          await sandbox.files.write(`${OUT_DIR}/${seed.path}`, seed.bytes)
          seedDigests.set(seed.path, digest(seed.bytes))
        }

        const seeded: string[] = []
        for (const input of inputs) {
          const name = sanitizeFilename(input.filename)
          await sandbox.files.write(`${IN_DIR}/${name}`, input.bytes)
          seeded.push(name)
        }

        await sandbox.files.write(
          "/root/.pi/agent/models.json",
          JSON.stringify(
            buildPiModelConfig({
              baseUrl: env.AI_GATEWAY_BASE_URL,
              model: env.MERLIN_MODEL,
            })
          )
        )
        await sandbox.files.write(BRIEF_FILE, brief(instructions, seeded))

        const collector = createPiEventCollector((step) => {
          logger.info({ subTool: step.toolName }, "Workbench: agent tool call")
          onStep?.(step)
        })
        let buffer = ""
        const onLine = (line: string) => {
          collector.consume(line)
        }

        const handle = sandbox.exec(
          PATH_PREFIX +
            buildPiCommand(env.MERLIN_MODEL, {
              tools: WORKBENCH_PI_TOOLS,
              promptFile: BRIEF_FILE,
              ...(task ? { session: { dir: SESSION_DIR, id: task.id } } : {}),
            }),
          {
            cwd: "/workspace",
            timeoutSec,
            onStdout: (chunk) => {
              buffer += chunk
              let nl = buffer.indexOf("\n")
              while (nl >= 0) {
                onLine(buffer.slice(0, nl))
                buffer = buffer.slice(nl + 1)
                nl = buffer.indexOf("\n")
              }
            },
          }
        )
        // A user stop / lease loss kills the agent instead of orphaning a
        // running sandbox session until its timeout.
        const onAbort = () => {
          handle.kill("KILL").catch(() => {})
        }
        abortSignal?.addEventListener("abort", onAbort, { once: true })
        const run = await handle
        abortSignal?.removeEventListener("abort", onAbort)
        if (buffer.trim()) onLine(buffer)
        const collected = collector.result()

        logger.info(
          { exitCode: run.exitCode, timedOut: run.timedOut },
          "Workbench: agent finished"
        )
        if (abortSignal?.aborted) return { error: "cancelled" }

        // A timeout or crash must not vaporize finished work: fall through to
        // harvest whatever reached /workspace/out and (for tasks) checkpoint
        // the workspace, so a follow-up session resumes instead of restarting.
        const failure = run.timedOut
          ? "timed out"
          : run.exitCode !== 0
            ? `failed: ${(run.stderr || run.stdout).slice(0, 300) || "unknown error"}`
            : collected.error && !collected.findings
              ? `failed: ${collected.error}`
              : null
        if (failure) {
          logger.warn(
            { failure, exitCode: run.exitCode },
            "Workbench: agent did not finish cleanly"
          )
        } else if (!collected.usage) {
          // Clean exit but no usage means pi silently did nothing — reject.
          return { error: "workbench agent returned no billable usage" }
        }

        const outputs = await walkOutputs(sandbox, OUT_DIR, 0)
        const files: WorkbenchFile[] = []
        const skipped: string[] = []
        let totalBytes = 0
        for (const output of outputs) {
          const rel = output.path.slice(OUT_DIR.length + 1)
          if (
            files.length >= env.MERLIN_WORKBENCH_MAX_FILES ||
            output.size > env.MERLIN_WORKBENCH_MAX_FILE_BYTES ||
            totalBytes + output.size > env.MERLIN_WORKBENCH_MAX_TOTAL_BYTES
          ) {
            skipped.push(rel)
            continue
          }
          const bytes = await sandbox.files.read(output.path, {
            format: "bytes",
          })
          if (!bytes) continue
          if (seedDigests.get(rel) === digest(bytes)) continue
          totalBytes += bytes.byteLength
          files.push({ path: rel, bytes, contentType: contentTypeFor(rel) })
        }
        if (skipped.length) {
          logger.warn({ skipped }, "Workbench: output files dropped by caps")
        }

        // Preserve the sub-agent's working state (scripts, scratch files,
        // session) for the task's next session. Failure only costs warmth.
        let checkpoint: string | undefined
        if (task) {
          const name = `task-${task.id}-${randomUUID().slice(0, 8)}`
          checkpoint = await sandbox.checkpoint(name).then(
            () => name,
            (err) => {
              logger.warn({ err, name }, "Workbench: checkpoint save failed")
              return undefined
            }
          )
        }

        if (failure && files.length === 0 && !checkpoint) {
          return { error: `workbench session ${failure}` }
        }

        return {
          files,
          summary:
            collected.findings ||
            (failure
              ? "(the session was cut short before the agent could summarize)"
              : "(no summary from the agent)"),
          ...(collected.usage ? { usage: collected.usage } : {}),
          skipped,
          ...(failure ? { failure } : {}),
          ...(checkpoint ? { checkpoint } : {}),
        }
      },
      {
        env: {
          AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY,
          IS_SANDBOX: "1",
        },
      },
      bootFrom
    )
  } catch (err) {
    logger.error({ err }, "Workbench: session failed")
    // If the checkpoint was deleted out from under us, re-verify next call.
    checkpointReady = null
    return { error: "workbench session failed (sandbox error)" }
  }
}
