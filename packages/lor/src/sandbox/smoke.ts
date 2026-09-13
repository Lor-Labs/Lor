import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

// Probe the image, then run a real write-mode workbench session (Pi + pandas,
// deliverables harvested from /workspace/out). Requires BL_API_KEY /
// BL_WORKSPACE and AI_GATEWAY_API_KEY. Dynamic imports so the @repo/env parse
// happens after dotenv has loaded.
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

async function workbenchSmoke(): Promise<void> {
  console.log("\nRunning a write-mode workbench session…")
  const { runWorkbenchSession } = await import("./workbench")
  const csv = "name,amount\nalpha,2\nbeta,3\n"
  const result = await runWorkbenchSession({
    instructions:
      "Read /workspace/in/numbers.csv with pandas and compute the total of the amount column. Deliver two files: total.md (one sentence stating the total) and total.csv (the input rows plus a final TOTAL row).",
    inputs: [{ filename: "numbers.csv", bytes: new TextEncoder().encode(csv) }],
    timeoutSec: 300,
  })
  if ("error" in result) throw new Error(result.error)
  console.log(`Agent summary: ${result.summary}`)
  for (const f of result.files) {
    console.log(`  out: ${f.path} (${f.contentType}, ${f.bytes.byteLength}b)`)
  }
  const md = result.files.find((f) => f.path === "total.md")
  if (!md) throw new Error("expected total.md in workbench outputs")
  const text = new TextDecoder().decode(md.bytes)
  if (!text.includes("5")) throw new Error(`unexpected total.md: ${text}`)
  console.log("Workbench smoke ✓")
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
  imageProbe()
    .then(workbenchSmoke)
    .catch((err) => {
      console.error("Sandbox smoke test failed:", err)
      process.exitCode = 1
    })
}
