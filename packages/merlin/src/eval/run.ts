import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

// Bootstrap for the eval harness. The harness drives Merlin through the shared
// @repo/db client, which connects from DATABASE_URL at import time — so we must
// point it at the throwaway EVAL_DB_URL *before* the harness (and thus @repo/db)
// loads. If EVAL_DB_URL isn't set, the eval is skipped (safe to run anywhere).
//
//   # .env (or exported): EVAL_DB_URL=postgres://…  (a test DB w/ pgvector + pg_trgm)
//   pnpm --filter @repo/merlin eval
//
// LLM keys (ANTHROPIC_API_KEY / OPENAI_API_KEY) come from your normal .env.

// Load .env the way @repo/env does, so EVAL_DB_URL is available up front.
dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

const evalDbUrl = process.env.EVAL_DB_URL

if (!evalDbUrl) {
  console.log(
    "EVAL_DB_URL is not set — skipping Merlin eval harness. Set it to a throwaway test database (with pgvector + pg_trgm) to run."
  )
} else {
  // Route every @repo/db query (respond, writePage, ingestSource, …) at the eval
  // DB. dotenv doesn't override an already-set var, so this sticks when @repo/env
  // re-loads .env inside the harness.
  process.env.DATABASE_URL = evalDbUrl
  import("./harness").catch((err) => {
    console.error("Eval harness crashed:", err)
    process.exitCode = 1
  })
}
