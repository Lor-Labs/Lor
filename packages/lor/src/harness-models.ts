import { db, eq, schema } from "@repo/db"
import type { ReportedHarnessModel } from "@repo/db/schema"

// Codex's model list from anyone's last turn: the starting list for people
// whose own Codex hasn't reported theirs (chatgpt-account.ts). Null until a
// turn reports it.
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
