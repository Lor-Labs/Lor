import { env } from "@repo/env/server"
import { logger } from "../logger"
import { withSandbox } from "./index"
import { buildPiCommand, buildPiModelConfig } from "./pi-config"
import {
  createPiEventCollector,
  type PiCodeStep,
  type PiInvestigationUsage,
} from "./pi-events"

export type InvestigationUsage = PiInvestigationUsage
export type CodeStep = PiCodeStep

export type InvestigationResult = {
  findings: string
  usage?: InvestigationUsage
}

const AGENT_TIMEOUT_SEC = 600
const CLONE_TIMEOUT_SEC = 180

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

export async function investigateCode(opts: {
  repoFullName: string
  cloneToken: string
  question: string
  onStep?: (step: CodeStep) => void
}): Promise<InvestigationResult | { error: string }> {
  const { repoFullName, cloneToken, question, onStep } = opts
  // Token is in the clone URL; scrub command output before logging.
  const cloneUrl = `https://x-access-token:${cloneToken}@github.com/${repoFullName}.git`
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
        // Strip the embedded access token from .git/config before the agent
        // explores — otherwise the (semi-trusted) checkout can read it back.
        await sandbox.exec(
          `git -C /repo remote set-url origin https://github.com/${repoFullName}.git`
        )
        logger.info({ repoFullName }, "Sandbox: clone ok; running code agent")

        await sandbox.exec("mkdir -p /root/.pi/agent")
        await sandbox.files.write(
          "/root/.pi/agent/models.json",
          JSON.stringify(
            buildPiModelConfig({
              baseUrl: env.AI_GATEWAY_BASE_URL,
              model: env.MERLIN_MODEL,
            })
          )
        )
        await sandbox.files.write("/investigation.txt", brief(question))

        const collector = createPiEventCollector((step) => {
          logger.info(
            { repoFullName, subTool: step.toolName },
            "Sandbox: agent tool call"
          )
          onStep?.(step)
        })
        let buffer = ""
        const onLine = (line: string) => {
          collector.consume(line)
        }

        const run = await sandbox.exec(buildPiCommand(env.MERLIN_MODEL), {
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
        })
        if (buffer.trim()) onLine(buffer)
        const collected = collector.result()

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
        if (collected.error && !collected.findings) {
          return { error: `code agent failed: ${collected.error}` }
        }

        const findings =
          collected.findings || "(no findings from the code agent)"
        if (!collected.findings) {
          logger.warn(
            { repoFullName, stdoutSample: scrub(run.stdout.slice(0, 500)) },
            "Sandbox: no final text parsed from Pi event stream"
          )
        }
        return { findings, usage: collected.usage }
      },
      {
        env: {
          AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY,
          IS_SANDBOX: "1",
        },
      }
    )
  } catch (err) {
    logger.error({ err, repoFullName }, "Sandbox: investigation failed")
    return { error: "code investigation failed (sandbox error)" }
  }
}
