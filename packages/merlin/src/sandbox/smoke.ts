import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { withSandbox } from "./index"
import { buildPiCommand, buildPiModelConfig } from "./pi-config"
import { createPiEventCollector } from "./pi-events"

dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

const CHECKS = [
  "echo hello from the sandbox",
  "pi --version",
  "git --version",
  "node --version",
]

async function main(): Promise<void> {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY
  if (!gatewayKey) {
    throw new Error("AI_GATEWAY_API_KEY is required for the Pi smoke test")
  }
  const model = process.env.MERLIN_MODEL || "moonshotai/kimi-k3"

  console.log("Creating sandbox and running a read-only Pi investigation…")
  await withSandbox(
    async (sandbox) => {
      console.log("Sandbox running. Probing the image:\n")
      for (const cmd of CHECKS) {
        const r = await sandbox.exec(cmd, { timeoutSec: 30 })
        const out = r.stdout.trim() || r.stderr.trim() || "(no output)"
        console.log(`$ ${cmd}\n  exit=${r.exitCode}  ${out}\n`)
        if (r.exitCode !== 0) throw new Error(`${cmd} failed: ${out}`)
      }

      const setup = await sandbox.exec("mkdir -p /repo /root/.pi/agent")
      if (setup.exitCode !== 0) throw new Error(setup.stderr)

      await sandbox.files.write(
        "/root/.pi/agent/models.json",
        JSON.stringify(
          buildPiModelConfig({
            baseUrl: process.env.AI_GATEWAY_BASE_URL,
            model,
          })
        )
      )
      await sandbox.files.write(
        "/repo/package.json",
        JSON.stringify({ name: "townhall-pi-smoke", private: true })
      )
      await sandbox.files.write(
        "/investigation.txt",
        "Read package.json and report its package name in one short sentence."
      )

      const run = await sandbox.exec(buildPiCommand(model), {
        cwd: "/repo",
        timeoutSec: 180,
      })
      const collector = createPiEventCollector()
      for (const line of run.stdout.split("\n")) collector.consume(line)
      const result = collector.result()

      if (run.exitCode !== 0) {
        throw new Error(run.stderr || run.stdout || "Pi exited non-zero")
      }
      if (!result.findings.includes("townhall-pi-smoke")) {
        throw new Error(`Unexpected Pi answer: ${result.findings || "(empty)"}`)
      }
      if (!result.usage) throw new Error("Pi returned no billable usage")
      console.log(`Pi (${result.usage?.model ?? model}): ${result.findings}`)
    },
    { env: { AI_GATEWAY_API_KEY: gatewayKey, IS_SANDBOX: "1" } }
  )
  console.log("Sandbox destroyed. ✓")
}

if (!(process.env.RAILWAY_API_TOKEN && process.env.RAILWAY_ENVIRONMENT_ID)) {
  console.log(
    "RAILWAY_API_TOKEN / RAILWAY_ENVIRONMENT_ID not set — skipping sandbox smoke test."
  )
} else {
  main().catch((err) => {
    console.error("Sandbox smoke test failed:", err)
    process.exitCode = 1
  })
}
