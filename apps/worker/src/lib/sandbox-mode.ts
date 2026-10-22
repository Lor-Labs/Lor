import { db, eq, schema } from "@repo/db"
import type { SandboxMode, TurnSandboxMode } from "@repo/db/schema"

// A person's sandbox mode; auto when they never chose one. An unknown starter
// (the author lookup failed) gets the strictest interactive mode.
async function userSandboxMode(userId: string | null): Promise<SandboxMode> {
  if (!userId) return "manual"
  const [row] = await db
    .select({ sandboxMode: schema.userSandboxSettings.sandboxMode })
    .from(schema.userSandboxSettings)
    .where(eq(schema.userSandboxSettings.userId, userId))
    .limit(1)
  return row?.sandboxMode ?? "auto"
}

// The sandbox mode a turn runs under, frozen at its start
// (reference/planned/pi-harness-runbook.md §4.6): a retried attempt keeps
// its saved mode, a resume keeps the paused turn's, Loop and Act runs are
// autonomous, and anything else takes the mode of whoever started it.
export async function turnSandboxMode(input: {
  saved: TurnSandboxMode | undefined
  paused: TurnSandboxMode | undefined
  automated: boolean
  userId: string | null
}): Promise<TurnSandboxMode> {
  if (input.saved) return input.saved
  if (input.paused) return input.paused
  if (input.automated) return "autonomous"
  return userSandboxMode(input.userId)
}
