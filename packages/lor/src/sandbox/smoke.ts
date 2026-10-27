import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

// Probe the sandbox image's tools in a real session sandbox (its disk and
// egress limits), created for a random owner and deleted after. Requires
// BL_API_KEY / BL_WORKSPACE. Dynamic imports so the @repo/env parse happens
// after dotenv has loaded.
async function imageProbe(): Promise<void> {
  const { deleteSessionSandbox, openSessionSandbox } = await import(
    "./session-sandbox"
  )
  const owner = { sessionId: randomUUID() }
  console.log("Creating a session sandbox and probing the image…")
  const sandbox = await openSessionSandbox(owner)
  try {
    const checks = [
      "git --version",
      "df -h /workspace",
      "node --version",
      "python3 -c 'import pandas, matplotlib, openpyxl, pdfplumber; print(pandas.__version__)'",
    ]
    for (const command of checks) {
      const r = await sandbox.session.run({ command })
      const out = r.stdout.trim() || r.stderr.trim() || "(no output)"
      console.log(`$ ${command}\n  exit=${r.exitCode}  ${out}\n`)
      if (r.exitCode !== 0) throw new Error(`${command} failed: ${out}`)
    }
  } finally {
    sandbox.close()
    await deleteSessionSandbox(owner)
  }
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
} else {
  imageProbe().catch((err) => {
    console.error("Sandbox smoke test failed:", err)
    process.exitCode = 1
  })
}
