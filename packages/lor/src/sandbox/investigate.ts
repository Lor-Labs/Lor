import { env } from "@repo/env/server"
import { logger } from "../logger"
import {
  execToCompletion,
  runPi,
  withEphemeralSandbox,
  writeText,
} from "./blaxel"
import { buildPiCommand, buildPiModelConfig } from "./pi-config"
import type {
  PiCodeHandlers,
  PiCodeStep,
  PiInvestigationUsage,
} from "./pi-events"

export type InvestigationUsage = PiInvestigationUsage
export type CodeStep = PiCodeStep

export type InvestigationResult = {
  findings: string
  usage?: InvestigationUsage
}

const AGENT_TIMEOUT_SEC = 600
const CLONE_TIMEOUT_SEC = 180

// The repo name is interpolated into a shell command; accept only the
// canonical owner/repo shape (resolveRepo passes the raw request through
// when the installation has no repo list to match against).
const REPO_FULL_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function brief(question: string): string {
  return [
    "You are investigating a codebase to answer a specific question. The repo is",
    "checked out at /workspace/repo (a shallow clone — git history is limited). Explore it",
    "(read files, grep) and produce a concise, accurate answer.",
    "",
    "When you reference code, cite exact locations as `path#Lstart-Lend` so they",
    "can be linked. Do not modify any files.",
    "",
    `Question: ${question}`,
  ].join("\n")
}

export async function investigateCode(
  opts: PiCodeHandlers & {
    repoFullName: string
    cloneToken: string
    question: string
  }
): Promise<InvestigationResult | { error: string }> {
  const { repoFullName, cloneToken, question, onStep, onAssistantText } = opts
  if (!REPO_FULL_NAME.test(repoFullName)) {
    return { error: `not a valid owner/repo name: ${repoFullName}` }
  }
  // The token reaches the sandbox as process env, never in the persisted
  // command string; scrub any output before logging regardless.
  const scrub = (s: string) => s.split(cloneToken).join("***")

  try {
    return await withEphemeralSandbox("inv", async (sandbox) => {
      logger.info({ repoFullName }, "Sandbox: cloning repo for investigation")
      const clone = await execToCompletion(sandbox, {
        command: `git clone --depth 1 --single-branch "https://x-access-token:$CLONE_TOKEN@github.com/${repoFullName}.git" /workspace/repo && git -C /workspace/repo remote set-url origin https://github.com/${repoFullName}.git`,
        env: { CLONE_TOKEN: cloneToken },
        timeoutSec: CLONE_TIMEOUT_SEC,
      })
      if (clone.status !== "completed" || clone.exitCode !== 0) {
        const stderr = scrub(clone.stderr.slice(0, 300))
        logger.warn(
          { repoFullName, exitCode: clone.exitCode, stderr },
          "Sandbox: git clone failed"
        )
        return { error: `clone failed: ${stderr}` }
      }
      logger.info({ repoFullName }, "Sandbox: clone ok; running code agent")

      await sandbox.process.exec({
        command:
          "mkdir -p /workspace/tmp /workspace/.cache /workspace/.local /root/.pi/agent",
        waitForCompletion: true,
        timeout: 30,
      })
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
      await writeText(sandbox, "/investigation.txt", brief(question))

      const run = await runPi(sandbox, {
        command: buildPiCommand(env.LOR_MODEL, { print: true }),
        timeoutSec: AGENT_TIMEOUT_SEC,
        workingDir: "/workspace/repo",
        ...(onStep ? { onStep } : {}),
        ...(onAssistantText ? { onAssistantText } : {}),
        logLabel: "Sandbox",
      })

      logger.info(
        {
          repoFullName,
          exitCode: run.result.exitCode,
          status: run.result.status,
          stdoutLen: run.result.stdout.length,
          stderrLen: run.result.stderr.length,
        },
        "Sandbox: code agent finished"
      )
      if (run.result.status === "killed" || run.result.status === "lost") {
        logger.warn({ repoFullName }, "Sandbox: code agent timed out")
        return { error: "code investigation timed out" }
      }
      if (run.result.status !== "completed" || run.result.exitCode !== 0) {
        logger.warn(
          {
            repoFullName,
            exitCode: run.result.exitCode,
            stderr: scrub(run.result.stderr.slice(0, 500)),
            stdout: scrub(run.result.stdout.slice(0, 500)),
          },
          "Sandbox: code agent exited non-zero"
        )
        const detail = scrub(
          (run.result.stderr || run.result.stdout).slice(0, 300)
        )
        return { error: `code agent failed: ${detail || "unknown error"}` }
      }
      if (run.error && !run.findings) {
        return { error: `code agent failed: ${run.error}` }
      }
      if (!run.usage) {
        logger.warn(
          {
            repoFullName,
            stdoutSample: scrub(run.result.stdout.slice(0, 500)),
          },
          "Sandbox: Pi returned findings without billable usage"
        )
        return { error: "code agent returned no billable usage" }
      }

      const findings = run.findings || "(no findings from the code agent)"
      if (!run.findings) {
        logger.warn(
          {
            repoFullName,
            stdoutSample: scrub(run.result.stdout.slice(0, 500)),
          },
          "Sandbox: no final text parsed from Pi event stream"
        )
      }
      return { findings, usage: run.usage }
    })
  } catch (err) {
    logger.error({ err, repoFullName }, "Sandbox: investigation failed")
    return { error: "code investigation failed (sandbox error)" }
  }
}
