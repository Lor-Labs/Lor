import { db, eq, schema } from "@repo/db"
import type { ReportedHarnessModel } from "@repo/db/schema"

// A harness's own model list from its last turn, where the list is Lor's
// rather than the person's (Codex; Claude Code's is in claude-account.ts).
// Null until a turn reports it.
export async function harnessModels(
  harness: "codex"
): Promise<ReportedHarnessModel[] | null> {
  const [row] = await db
    .select({ models: schema.harnessModelList.models })
    .from(schema.harnessModelList)
    .where(eq(schema.harnessModelList.harness, harness))
    .limit(1)
  return row?.models ?? null
}

export async function saveHarnessModels(
  harness: "codex",
  models: ReportedHarnessModel[]
): Promise<void> {
  await db
    .insert(schema.harnessModelList)
    .values({ harness, models })
    .onConflictDoUpdate({
      target: schema.harnessModelList.harness,
      set: { models },
    })
}
