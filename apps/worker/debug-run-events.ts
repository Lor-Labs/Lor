import { db, eq, inArray, schema } from "@repo/db"

const events = await db
  .select({
    runId: schema.agentRunEvent.runId,
    seq: schema.agentRunEvent.seq,
    payload: schema.agentRunEvent.payload,
  })
  .from(schema.agentRunEvent)
  .where(
    inArray(schema.agentRunEvent.runId, [
      "27d2eb79-0000-0000-0000-000000000000",
    ])
  )

const runs = await db.select({ id: schema.agentRun.id }).from(schema.agentRun)

const target = runs.find((r) => r.id.startsWith("27d2eb79"))
const failed = runs.find((r) => r.id.startsWith("689650ca"))

for (const run of [failed, target]) {
  if (!run) continue
  const rows = await db
    .select({
      seq: schema.agentRunEvent.seq,
      payload: schema.agentRunEvent.payload,
    })
    .from(schema.agentRunEvent)
    .where(eq(schema.agentRunEvent.runId, run.id))
    .orderBy(schema.agentRunEvent.seq)
  console.log("=== run", run.id.slice(0, 8))
  for (const e of rows) {
    const p = e.payload as {
      kind: string
      toolCall?: {
        toolName?: string
        status?: string
        detail?: { summary?: string }
      }
    }
    if (p.kind !== "tool" || p.toolCall?.toolName !== "create_artifacts")
      continue
    console.log(
      "  seq",
      e.seq,
      "status",
      p.toolCall.status ?? "-",
      "summary:",
      JSON.stringify(p.toolCall.detail?.summary?.slice(0, 400) ?? "")
    )
  }
}
process.exit(0)
