import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { withSandbox } from "./index"

// Smoke test for Railway Sandboxes — confirms a sandbox boots, commands run, and
// the agent CLIs (Claude Code / Codex) + git are present in the default image,
// before we build the repo-map flow on top. Skips if creds aren't set.
//
//   # .env (or exported): RAILWAY_API_TOKEN=… RAILWAY_ENVIRONMENT_ID=…
//   pnpm --filter @repo/merlin sandbox:smoke

dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

const CHECKS = [
  "echo hello from the sandbox",
  "claude --version",
  "codex --version",
  "git --version",
  "node --version",
]

async function main(): Promise<void> {
  console.log("Creating sandbox…")
  await withSandbox(async (sandbox) => {
    console.log("Sandbox running. Probing the image:\n")
    for (const cmd of CHECKS) {
      const r = await sandbox.exec(cmd, { timeoutSec: 30 })
      const out = r.stdout.trim() || r.stderr.trim() || "(no output)"
      console.log(`$ ${cmd}\n  exit=${r.exitCode}  ${out}\n`)
    }
  })
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
