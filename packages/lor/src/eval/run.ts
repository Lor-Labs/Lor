import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

// DATABASE_URL is read at import time; redirect it before loading the harness.
dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

const evalDbUrl = process.env.EVAL_DB_URL
const long = process.argv.includes("--long")

if (!evalDbUrl) {
  console.log(
    "EVAL_DB_URL is not set — skipping Lor eval harness. Set it to a throwaway test database (with pgvector + pg_trgm) to run."
  )
} else {
  process.env.DATABASE_URL = evalDbUrl
  // Long tasks: a stalled provider stream must end the attempt, not the eval.
  if (long) process.env.AGENT_RUN_MAX_WALL_MS ??= "600000"
  import(long ? "./long/harness" : "./harness").catch((err) => {
    console.error("Eval harness crashed:", err)
    process.exitCode = 1
  })
}
