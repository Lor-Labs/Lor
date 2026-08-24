import { and, eq, ne, schema } from "@repo/db"
import { composeRunChainBriefing } from "./act-runs"

// What earlier runs of this loop concluded/did (their handoff notes +
// recorded actions), plus channel activity since the last one. Loop runs
// serialize on scopeKey = loop.id, so this is a coherent chain — same
// machinery as the Act briefing, but with no age cutoff: a weekly loop's
// predecessor ran seven days ago and is exactly what the successor needs.
export async function loopRunBriefing(input: {
  loopId: string
  channelId: string
  // The run being briefed (excluded from its own history).
  runId: string
}): Promise<string | null> {
  return composeRunChainBriefing({
    history: and(
      eq(schema.agentRun.loopId, input.loopId),
      ne(schema.agentRun.id, input.runId)
    ),
    channelId: input.channelId,
    headerFor: (totalRuns) =>
      `## Earlier runs of this loop (newest first; ${totalRuns} total)`,
  })
}
