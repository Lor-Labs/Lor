import { env } from "@repo/env/server"
import { logger } from "../logger"
import { withSandbox } from "./index"

// Code investigation in an ephemeral sandbox (§7.4). Per query: shallow-clone the
// repo (no deps, no checkpoint — always fresh), run the code agent (Claude Code)
// as an autonomous sub-agent against the clone, STREAM its tool calls back as it
// works, capture its findings + token usage, then tear the sandbox down. The
// agent has its OWN context on the box; we hand it a focused brief and get back a
// synthesis, which Merlin then composes into the user-facing answer.
//
// ⚠️ NOT runnable without a Railway sandbox — the `claude` flags + the
// stream-json event shape are isolated here so this is the only place to adjust.

export type InvestigationUsage = {
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

// A single tool call the in-sandbox agent made (streamed live for the UI).
export type CodeStep = { toolName: string; label: string }

export type InvestigationResult = {
  findings: string
  usage?: InvestigationUsage
}

// Generous ceiling for a single investigation; the sandbox is destroyed after.
const AGENT_TIMEOUT_SEC = 600
const CLONE_TIMEOUT_SEC = 180
// Cap on the raw-stdout fallback fed to Merlin if no result event is parsed.
const FALLBACK_MAX = 8000

function brief(question: string): string {
  return [
    "You are investigating a codebase to answer a specific question. The repo is",
    "checked out at /repo (a shallow clone — git history is limited). Explore it",
    "(read files, grep) and produce a concise, accurate answer.",
    "",
    "When you reference code, cite exact locations as `path#Lstart-Lend` so they",
    "can be linked. Do not modify any files.",
    "",
    `Question: ${question}`,
  ].join("\n")
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

// Human label for an in-sandbox agent tool call (Claude Code tool names).
function subToolLabel(name: string, input: unknown): string {
  const r = asRecord(input)
  const file = asString(r?.file_path)
  const pattern = asString(r?.pattern)
  const command = asString(r?.command)
  switch (name) {
    case "Read":
      return file ? `Read ${file}` : "Read a file"
    case "Grep":
      return pattern ? `Searched for “${pattern}”` : "Searched the code"
    case "Glob":
      return pattern ? `Listed files: ${pattern}` : "Listed files"
    case "Bash":
      return command ? `Ran: ${command.slice(0, 60)}` : "Ran a command"
    case "LS":
      return "Listed a directory"
    default:
      return name
  }
}

export async function investigateCode(opts: {
  // "owner/repo"
  repoFullName: string
  // Short-lived GitHub installation token for cloning the private repo.
  cloneToken: string
  question: string
  // Called for each tool call the in-sandbox agent makes, as it happens.
  onStep?: (step: CodeStep) => void
}): Promise<InvestigationResult | { error: string }> {
  const { repoFullName, cloneToken, question, onStep } = opts
  // Token is inlined in the clone URL (visible to `ps` inside the box) — acceptable
  // for an ephemeral, isolated, short-lived sandbox; ANTHROPIC_API_KEY is baked as
  // sandbox env instead so it isn't in any command string.
  const cloneUrl = `https://x-access-token:${cloneToken}@github.com/${repoFullName}.git`
  // git may echo the clone URL (with the token) in errors — scrub before logging.
  const scrub = (s: string) => s.split(cloneToken).join("***")

  try {
    return await withSandbox(
      async (sandbox) => {
        logger.info({ repoFullName }, "Sandbox: cloning repo for investigation")
        const clone = await sandbox.exec(
          `git clone --depth 1 --single-branch ${cloneUrl} /repo`,
          { timeoutSec: CLONE_TIMEOUT_SEC }
        )
        if (clone.exitCode !== 0) {
          const stderr = scrub(clone.stderr.slice(0, 300))
          logger.warn(
            { repoFullName, exitCode: clone.exitCode, stderr },
            "Sandbox: git clone failed"
          )
          return { error: `clone failed: ${stderr}` }
        }
        logger.info({ repoFullName }, "Sandbox: clone ok; running code agent")

        // Parse Claude Code's stream-json (JSONL) as it arrives: assistant
        // tool_use blocks → live steps; the final `result` event → findings +
        // usage. ⚠️ event shape unverified live; defensive throughout.
        let resultText = ""
        let usage: InvestigationUsage | undefined
        let buffer = ""
        const onLine = (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) return
          let evt: Record<string, unknown> | undefined
          try {
            evt = asRecord(JSON.parse(trimmed))
          } catch {
            return
          }
          if (!evt) return
          const type = asString(evt.type)
          if (type === "assistant") {
            const content = asRecord(evt.message)?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = asRecord(block)
                if (asString(b?.type) === "tool_use") {
                  const name = asString(b?.name) ?? "tool"
                  logger.info(
                    { repoFullName, subTool: name },
                    "Sandbox: agent tool call"
                  )
                  onStep?.({
                    toolName: name,
                    label: subToolLabel(name, b?.input),
                  })
                }
              }
            }
          } else if (type === "result") {
            resultText = asString(evt.result) ?? resultText
            const u = asRecord(evt.usage)
            const parsed: InvestigationUsage = {
              model: asString(evt.model),
              inputTokens: asNumber(u?.input_tokens),
              outputTokens: asNumber(u?.output_tokens),
              costUsd: asNumber(evt.total_cost_usd),
            }
            if (Object.values(parsed).some((x) => x !== undefined))
              usage = parsed
          }
        }

        await sandbox.files.write("/investigation.txt", brief(question))
        // IS_SANDBOX=1 + --dangerously-skip-permissions let Claude Code run headless
        // as root (the sandbox's default user). stream-json needs --verbose.
        const run = await sandbox.exec(
          "sh -c 'cat /investigation.txt | claude -p --output-format stream-json --verbose --dangerously-skip-permissions'",
          {
            cwd: "/repo",
            timeoutSec: AGENT_TIMEOUT_SEC,
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
        if (buffer.trim()) onLine(buffer)

        logger.info(
          {
            repoFullName,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            stdoutLen: run.stdout.length,
            stderrLen: run.stderr.length,
          },
          "Sandbox: code agent finished"
        )
        if (run.timedOut) {
          logger.warn({ repoFullName }, "Sandbox: code agent timed out")
          return { error: "code investigation timed out" }
        }
        if (run.exitCode !== 0) {
          logger.warn(
            {
              repoFullName,
              exitCode: run.exitCode,
              stderr: scrub(run.stderr.slice(0, 500)),
              stdout: scrub(run.stdout.slice(0, 500)),
            },
            "Sandbox: code agent exited non-zero"
          )
          const detail = scrub((run.stderr || run.stdout).slice(0, 300))
          return { error: `code agent failed: ${detail || "unknown error"}` }
        }

        const findings =
          resultText.trim() ||
          scrub(run.stdout).slice(0, FALLBACK_MAX) ||
          "(no findings from the code agent)"
        if (!resultText.trim()) {
          logger.warn(
            { repoFullName, stdoutSample: scrub(run.stdout.slice(0, 500)) },
            "Sandbox: no result event parsed from agent stream"
          )
        }
        return { findings, usage }
      },
      { env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, IS_SANDBOX: "1" } }
    )
  } catch (err) {
    // Sandbox create / transport failures (would otherwise be swallowed by the
    // tool's .catch and only show as a generic "investigation failed").
    logger.error({ err, repoFullName }, "Sandbox: investigation failed")
    return { error: "code investigation failed (sandbox error)" }
  }
}
