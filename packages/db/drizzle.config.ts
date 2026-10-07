import { readServerEnv } from "@repo/env/server-fields"
import { defineConfig } from "drizzle-kit"

const env = readServerEnv("DATABASE_URL")

export default defineConfig({
  schema: "./src/schemas",
  out: "./drizzle",
  dialect: "postgresql",
  // Views the pg_stat_statements extension owns (installed by hand on
  // Railway); push would otherwise try to drop them, which Postgres refuses.
  tablesFilter: ["!pg_stat_statements*"],
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
