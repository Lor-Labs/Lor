import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

// Probe the sandbox image's tools. Requires BL_API_KEY / BL_WORKSPACE and
// AI_GATEWAY_API_KEY. Dynamic imports so the @repo/env parse happens after
// dotenv has loaded.
async function imageProbe(): Promise<void> {
  const { execToCompletion, withEphemeralSandbox } = await import("./blaxel")
  console.log("Creating sandbox and probing the image…")
  await withEphemeralSandbox("smoke", async (sandbox) => {
    const checks = [
      "pi --version",
      "git --version",
      "df -h /workspace",
      "node --version",
      "python3 -c 'import pandas, matplotlib, openpyxl, pdfplumber; print(pandas.__version__)'",
    ]
    for (const cmd of checks) {
      const r = await execToCompletion(sandbox, {
        command: cmd,
        timeoutSec: 60,
      })
      const out = r.stdout.trim() || r.stderr.trim() || "(no output)"
      console.log(`$ ${cmd}\n  exit=${r.exitCode}  ${out}\n`)
      if (r.exitCode !== 0) throw new Error(`${cmd} failed: ${out}`)
    }
  })
  console.log("Image probe ✓")
}

if (Boolean(process.env.BL_API_KEY) !== Boolean(process.env.BL_WORKSPACE)) {
  console.error(
    "Only one of BL_API_KEY / BL_WORKSPACE is set — set both (or neither)."
  )
  process.exitCode = 1
} else if (!process.env.BL_API_KEY) {
  console.log(
    "BL_API_KEY / BL_WORKSPACE not set — skipping sandbox smoke test."
  )
} else if (!process.env.AI_GATEWAY_API_KEY) {
  console.log("AI_GATEWAY_API_KEY not set — skipping sandbox smoke test.")
} else {
  imageProbe().catch((err) => {
    console.error("Sandbox smoke test failed:", err)
    process.exitCode = 1
  })
}
