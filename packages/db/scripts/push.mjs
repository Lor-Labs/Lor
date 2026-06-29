import { spawn } from "node:child_process"

// `pnpm db:push [--url <url>]` — optionally override the target database (e.g. to
// push the schema to a throwaway eval DB) without touching your .env DATABASE_URL.
// The url is applied to the spawned drizzle-kit's env only, so drizzle.config.ts
// (dialect/schema/out) is otherwise unchanged. Any other flags (--force, etc.)
// pass straight through to `drizzle-kit push`.
const argv = process.argv.slice(2)
const passthrough = []
let url

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === "--url" || arg === "-u") {
    const next = argv[i + 1]
    if (!next || next.startsWith("-")) {
      console.error(`${arg} requires a value`)
      process.exit(1)
    }
    url = next
    i += 1
  } else if (arg.startsWith("--url=")) {
    url = arg.slice("--url=".length)
  } else if (arg.startsWith("-u=")) {
    url = arg.slice("-u=".length)
  } else {
    passthrough.push(arg)
  }
}

const env = { ...process.env }
if (url) env.DATABASE_URL = url

const child = spawn("drizzle-kit", ["push", ...passthrough], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
