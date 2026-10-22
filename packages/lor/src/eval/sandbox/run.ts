import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"

// DATABASE_URL is read at import time. Real traffic is read (never written)
// from the dev database; --eval-db reads EVAL_DB_URL instead.
dotenvConfig({ path: resolve(process.cwd(), ".env") })
dotenvConfig({ path: resolve(process.cwd(), "../../.env") })

if (process.argv.includes("--eval-db")) {
  if (!process.env.EVAL_DB_URL) {
    console.error("--eval-db needs EVAL_DB_URL")
    process.exit(1)
  }
  process.env.DATABASE_URL = process.env.EVAL_DB_URL
}

await import("./harness")
