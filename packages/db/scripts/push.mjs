import { spawn } from "node:child_process"

// `pnpm db:push [--url <url>]` — optionally override the target database (e.g. to
// push the schema to a throwaway eval DB) without touching your .env DATABASE_URL.
// The url is applied to the spawned processes' env only, so drizzle.config.ts
// (dialect/schema/out) is otherwise unchanged. Any other flags (--force, etc.)
// pass straight through to `drizzle-kit push`. The scripts in BEFORE_PUSH run
// first: drizzle-kit can't create extensions, and a push that drops columns
// must not run before their data is moved.
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

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    })
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

// Before the push, in order: extensions, then data moves the push would
// otherwise destroy (agents-from-channels.ts copies each channel's agent
// settings onto `agent` rows before their columns are dropped), then a
// column drop the push would otherwise ask a question about.
const BEFORE_PUSH = [
  "src/scripts/ensure-extensions.ts",
  "src/scripts/agents-from-channels.ts",
  "src/scripts/agent-facts-unscoped.ts",
]

let code = 0
for (const script of BEFORE_PUSH) {
  code = await run("tsx", [script])
  if (code !== 0) break
}
process.exitCode =
  code === 0 ? await run("drizzle-kit", ["push", ...passthrough]) : code
