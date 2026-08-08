import { env } from "@repo/env/server"
import { Sandbox, type SandboxTemplate } from "railway"
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
  usage: WorkbenchUsage
  // Output files dropped by the harvest caps, so the caller can say so.
  skipped: string[]
}

const IN_DIR = "/workspace/in"
const OUT_DIR = "/workspace/out"
const BRIEF_FILE = "/workbench.txt"
const MAX_WALK_DEPTH = 4

// Debian packages: python3 + the data/report toolchain. Content-addressed and
// cached server-side, so this builds once and later sandboxes boot from the
// cached image. Extending to pptx/docx later = more packages here.
let template: SandboxTemplate | null = null
function workbenchTemplate(): SandboxTemplate {
  template ??= Sandbox.template().withPackages(
    "python3",
    "python3-pandas",
    "python3-matplotlib",
    "python3-openpyxl"
  )
  return template
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
    "Python 3 is installed with pandas, matplotlib, and openpyxl. Write and run",
    "scripts as needed.",
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

// One ephemeral workbench session: boot from the template, seed inputs, run
// the Pi coding agent with write tools, harvest the output directory, destroy
// the sandbox. Files live on only through what the caller persists.
export async function runWorkbenchSession(opts: {
  instructions: string
  inputs: WorkbenchInput[]
  timeoutSec: number
  abortSignal?: AbortSignal
  onStep?: (step: WorkbenchStep) => void
}): Promise<WorkbenchResult | { error: string }> {
  const { instructions, inputs, timeoutSec, abortSignal, onStep } = opts
  if (abortSignal?.aborted) return { error: "cancelled" }

  try {
    return await withSandbox(
      async (sandbox) => {
        await sandbox.exec(`mkdir -p ${IN_DIR} ${OUT_DIR} /root/.pi/agent`, {
          timeoutSec: 30,
        })

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
          buildPiCommand(env.MERLIN_MODEL, {
            tools: WORKBENCH_PI_TOOLS,
            promptFile: BRIEF_FILE,
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
        if (run.timedOut) return { error: "workbench session timed out" }
        if (run.exitCode !== 0) {
          const detail = (run.stderr || run.stdout).slice(0, 300)
          logger.warn(
            { exitCode: run.exitCode, detail },
            "Workbench: agent exited non-zero"
          )
          return {
            error: `workbench agent failed: ${detail || "unknown error"}`,
          }
        }
        if (collected.error && !collected.findings) {
          return { error: `workbench agent failed: ${collected.error}` }
        }
        if (!collected.usage) {
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
          totalBytes += bytes.byteLength
          files.push({ path: rel, bytes, contentType: contentTypeFor(rel) })
        }
        if (skipped.length) {
          logger.warn({ skipped }, "Workbench: output files dropped by caps")
        }

        return {
          files,
          summary: collected.findings || "(no summary from the agent)",
          usage: collected.usage,
          skipped,
        }
      },
      {
        env: {
          AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY,
          IS_SANDBOX: "1",
        },
      },
      workbenchTemplate()
    )
  } catch (err) {
    logger.error({ err }, "Workbench: session failed")
    return { error: "workbench session failed (sandbox error)" }
  }
}
