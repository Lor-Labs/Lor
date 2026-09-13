import { createHash } from "node:crypto"
import { env } from "@repo/env/server"
import { logger } from "../logger"
import {
  type BlaxelSandbox,
  runPi,
  withEphemeralSandbox,
  withWorkbenchSandbox,
  writeText,
} from "./blaxel"
import {
  buildPiCommand,
  buildPiModelConfig,
  WORKBENCH_PI_TOOLS,
} from "./pi-config"
import type {
  PiCodeHandlers,
  PiCodeStep,
  PiInvestigationUsage,
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
  // Set when the agent didn't finish cleanly (timeout, crash) but partial
  // work was still harvested — the caller tells the model so it can continue
  // instead of starting over.
  failure?: string
}

// Scope continuity is the conversation's persistent sandbox plus
// /workspace/out reset to the current artifact versions (humans may have
// edited since the sandbox last ran). The sandbox key is the run's scope key
// (a uuid), which doubles as the Pi session id.
export type WorkbenchContinuity = {
  sandboxKey: string
  outSeed: { path: string; bytes: Uint8Array }[]
}

const IN_DIR = "/workspace/in"
const OUT_DIR = "/workspace/out"
const BRIEF_FILE = "/workbench.txt"
const SESSION_DIR = "/workspace/.pi-sessions"
const MAX_WALK_DEPTH = 4

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

// Artifact paths come from our own harvest, but they originate as filenames
// the agent chose — never let one escape the output dir or break the shell
// quoting in the mkdir command.
const SAFE_SEED_PATH = /^[A-Za-z0-9 ._/-]+$/
function isUnsafeSeedPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    !SAFE_SEED_PATH.test(path)
  )
}

async function walkOutputs(
  sandbox: BlaxelSandbox,
  dir: string,
  depth: number
): Promise<{ path: string; size: number }[]> {
  if (depth > MAX_WALK_DEPTH) {
    logger.warn({ dir }, "Workbench: output dir deeper than walk cap; skipped")
    return []
  }
  const listing = await sandbox.fs.ls(dir).catch(() => null)
  if (!listing) return []
  // Listings report absolute paths; a bare name would slice into a corrupted
  // artifact path downstream, so root it against the directory we listed.
  const found: { path: string; size: number }[] = (listing.files ?? []).map(
    (f) => ({
      path: f.path.startsWith("/") ? f.path : `${dir}/${f.path}`,
      size: f.size,
    })
  )
  for (const sub of listing.subdirectories ?? []) {
    const path = sub.path.startsWith("/") ? sub.path : `${dir}/${sub.path}`
    found.push(...(await walkOutputs(sandbox, path, depth + 1)))
  }
  return found
}

// One workbench session: connect the (scope-persistent or ephemeral) sandbox,
// reconcile seeds, run the Pi coding agent with write tools, harvest the
// output directory. Files live on only through what the caller persists.
export async function runWorkbenchSession(
  opts: PiCodeHandlers & {
    instructions: string
    inputs: WorkbenchInput[]
    timeoutSec: number
    abortSignal?: AbortSignal
    continuity?: WorkbenchContinuity
  }
): Promise<WorkbenchResult | { error: string }> {
  const {
    instructions,
    inputs,
    timeoutSec,
    abortSignal,
    onStep,
    onAssistantText,
    continuity,
  } = opts
  if (abortSignal?.aborted) return { error: "cancelled" }

  const session = async (
    sandbox: BlaxelSandbox
  ): Promise<WorkbenchResult | { error: string }> => {
    // Seed subdirectories must exist before writeBinary; one exec covers the
    // fixed dirs plus every seed parent. Persistent sandboxes reset
    // /workspace/out to the seed first — artifact rows are the source of
    // truth, and stale leftovers from a prior session would re-harvest as
    // duplicate artifact rows (standalone artifacts have no path identity).
    const seedDirs = new Set<string>()
    for (const seed of continuity?.outSeed ?? []) {
      if (isUnsafeSeedPath(seed.path)) continue
      const parent = seed.path.split("/").slice(0, -1).join("/")
      if (parent) seedDirs.add(`${OUT_DIR}/${parent}`)
    }
    const mkdir = await sandbox.process.exec({
      command: `${continuity ? `rm -rf ${OUT_DIR} && ` : ""}mkdir -p ${IN_DIR} ${OUT_DIR} ${SESSION_DIR} /workspace/tmp /workspace/.cache /workspace/.local /root/.pi/agent ${[...seedDirs].map((d) => `'${d}'`).join(" ")}`,
      waitForCompletion: true,
      timeout: 30,
    })
    // Without the directories every seed write fails; stop with a clear cause.
    if ("exitCode" in mkdir && mkdir.exitCode !== 0) {
      return { error: `workbench setup failed (mkdir exit ${mkdir.exitCode})` }
    }

    const digest = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex")
    const seedDigests = new Map<string, string>()
    for (const seed of continuity?.outSeed ?? []) {
      if (isUnsafeSeedPath(seed.path)) {
        logger.warn({ path: seed.path }, "Workbench: skipped unsafe seed path")
        continue
      }
      await sandbox.fs.writeBinary(`${OUT_DIR}/${seed.path}`, seed.bytes)
      seedDigests.set(seed.path, digest(seed.bytes))
    }

    const seeded: string[] = []
    for (const input of inputs) {
      const filename = sanitizeFilename(input.filename)
      await sandbox.fs.writeBinary(`${IN_DIR}/${filename}`, input.bytes)
      seeded.push(filename)
    }

    await writeText(
      sandbox,
      "/root/.pi/agent/models.json",
      JSON.stringify(
        buildPiModelConfig({
          baseUrl: env.AI_GATEWAY_BASE_URL,
          model: env.LOR_MODEL,
        })
      )
    )
    await writeText(sandbox, BRIEF_FILE, brief(instructions, seeded))

    const run = await runPi(sandbox, {
      command: buildPiCommand(env.LOR_MODEL, {
        tools: WORKBENCH_PI_TOOLS,
        promptFile: BRIEF_FILE,
        print: true,
        ...(continuity
          ? { session: { dir: SESSION_DIR, id: continuity.sandboxKey } }
          : {}),
      }),
      timeoutSec,
      workingDir: "/workspace",
      abortSignal,
      ...(onStep ? { onStep } : {}),
      ...(onAssistantText ? { onAssistantText } : {}),
      logLabel: "Workbench",
    })

    logger.info(
      { exitCode: run.result.exitCode, status: run.result.status },
      "Workbench: agent finished"
    )
    if (abortSignal?.aborted) return { error: "cancelled" }

    // A timeout or crash must not vaporize finished work: fall through and
    // harvest whatever reached /workspace/out — the plan's next session
    // resumes the same sandbox instead of restarting.
    const errorDetail =
      (run.result.stderr || run.result.stdout).slice(0, 300) || "unknown error"
    const failure =
      run.result.status !== "completed"
        ? run.result.status === "killed" || run.result.status === "lost"
          ? "timed out"
          : `failed: ${errorDetail}`
        : run.result.exitCode !== 0
          ? `failed: ${errorDetail}`
          : run.error && !run.findings
            ? `failed: ${run.error}`
            : null
    if (failure) {
      logger.warn(
        { failure, exitCode: run.result.exitCode, status: run.result.status },
        "Workbench: agent did not finish cleanly"
      )
    } else if (!run.usage) {
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
        files.length >= env.LOR_WORKBENCH_MAX_FILES ||
        output.size > env.LOR_WORKBENCH_MAX_FILE_BYTES ||
        totalBytes + output.size > env.LOR_WORKBENCH_MAX_TOTAL_BYTES
      ) {
        skipped.push(rel)
        continue
      }
      const blob = await sandbox.fs.readBinary(output.path).catch(() => null)
      if (!blob) continue
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (seedDigests.get(rel) === digest(bytes)) continue
      totalBytes += bytes.byteLength
      files.push({ path: rel, bytes, contentType: contentTypeFor(rel) })
    }
    if (skipped.length) {
      logger.warn({ skipped }, "Workbench: output files dropped by caps")
    }

    if (failure && files.length === 0 && !continuity) {
      return { error: `workbench session ${failure}` }
    }

    return {
      files,
      summary:
        run.findings ||
        (failure
          ? "(the session was cut short before the agent could summarize)"
          : "(no summary from the agent)"),
      ...(run.usage ? { usage: run.usage } : {}),
      skipped,
      ...(failure ? { failure } : {}),
    }
  }

  try {
    return continuity
      ? await withWorkbenchSandbox(continuity.sandboxKey, session)
      : await withEphemeralSandbox("wb", session)
  } catch (err) {
    logger.error({ err }, "Workbench: session failed")
    return { error: "workbench session failed (sandbox error)" }
  }
}
