// Creates the Postgres extensions the schema needs. scripts/push.mjs runs it
// before every `pnpm db:push`, so a new database gets them with no manual
// step. Idempotent. Only extensions the server ships can be created; Railway's
// managed Postgres offers these three.
import { sql } from "drizzle-orm"
import { closeDb, db } from "../index"

// vector: halfvec embeddings and HNSW indexes. pg_trgm: trigram index on
// messages. pg_stat_statements: query stats (drizzle.config.ts excludes its
// views from push).
const EXTENSIONS = ["vector", "pg_trgm", "pg_stat_statements"]

for (const name of EXTENSIONS) {
  await db.execute(sql.raw(`create extension if not exists ${name}`))
}
await closeDb()
