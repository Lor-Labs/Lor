import { readServerEnv } from "@repo/env/server-fields"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schemas/index"

const { DATABASE_URL } = readServerEnv("DATABASE_URL")
const client = postgres(DATABASE_URL)
export const db = drizzle(client, { schema })

export async function closeDb(): Promise<void> {
  await client.end()
}

export { schema }
export * from "drizzle-orm"
export * from "./constants"
export * from "./errors"
