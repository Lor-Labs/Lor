// Dev only: gives an ended call a made-up summary and its search passage, so
// the call's Summary tab can be seen without running the after-call job
// (reference/voice-channels-runbook.md V7). The content is fake on purpose and
// never reads the transcript; item times are spread across the call's length.
//
//   pnpm --filter @repo/worker exec tsx src/scripts/seed-call-summary.ts <sessionId> [--edited]
//
// --edited also records a correction by the first person who joined, so
// "Edited by" shows.
import { asc, db, eq, schema } from "@repo/db"
import type { VoiceSessionSummary } from "@repo/db/schema"
import { embedDocumentsWithUsage } from "@repo/lor/embeddings"
import {
  saveCallMemory,
  saveEditedSummary,
  summaryPassageFor,
} from "@repo/voice/server"

const [sessionId] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const edited = process.argv.includes("--edited")
if (!sessionId) {
  console.error("Pass a session id")
  process.exit(1)
}

const [call] = await db
  .select({
    startedAt: schema.voiceSession.startedAt,
    endedAt: schema.voiceSession.endedAt,
  })
  .from(schema.voiceSession)
  .where(eq(schema.voiceSession.id, sessionId))
  .limit(1)
if (!call?.endedAt) {
  console.error("No ended call for that id")
  process.exit(1)
}
const length = call.endedAt.getTime() - call.startedAt.getTime()
const at = (fraction: number) => Math.round(length * fraction)

const [first] = await db
  .select({
    userId: schema.voiceSessionParticipant.userId,
    name: schema.user.name,
  })
  .from(schema.voiceSessionParticipant)
  .innerJoin(
    schema.user,
    eq(schema.user.id, schema.voiceSessionParticipant.userId)
  )
  .where(eq(schema.voiceSessionParticipant.sessionId, sessionId))
  .orderBy(asc(schema.voiceSessionParticipant.firstJoinedAt))
  .limit(1)

const lorSummary: VoiceSessionSummary = {
  title: "Voice channels launch review",
  summary:
    "The team reviewed the voice channels launch. They agreed to ship call summaries and Lor's answers about past calls in the next release, and to keep approvals desktop-only until the phone app has the call pill.",
  decisions: [
    {
      text: "Ship call summaries and Lor's answers about past calls in the next release.",
      atMs: at(0.15),
    },
    {
      text: "Keep approvals desktop-only until the phone app has the call pill.",
      atMs: at(0.45),
    },
  ],
  openQuestions: [
    {
      text: "Should the summary card also show who was in the call?",
      atMs: at(0.62),
    },
  ],
  actionItems: [
    {
      owner: first?.name ?? null,
      title: "Write the voice channels release notes",
      detail:
        "Cover summaries, Lor's answers about past calls, and the approval limits on phones, ready by Friday.",
      atMs: at(0.78),
    },
    {
      owner: null,
      title: "Run a full team call on phones before launch",
      detail:
        "Everyone joins from a phone for at least ten minutes, to check audio and the call chat.",
      atMs: at(0.9),
    },
  ],
}

const correction: VoiceSessionSummary = {
  ...lorSummary,
  decisions: [
    ...lorSummary.decisions,
    {
      text: "Show each person's face in the card header.",
      atMs: at(0.62),
    },
  ],
  openQuestions: [],
  actionItems: [
    ...lorSummary.actionItems,
    {
      owner: first?.name ?? null,
      title: "Check long summaries on a laptop screen",
      detail: null,
      atMs: null,
    },
  ],
}

async function passageFor(summary: VoiceSessionSummary) {
  const passage = await summaryPassageFor(sessionId as string, summary)
  if (!passage) throw new Error("Call not found")
  const embedding = await embedDocumentsWithUsage([
    `${passage.context}\n${passage.text}`,
  ])
    .then((result) => result.embeddings[0] ?? null)
    .catch(() => null)
  return { ...passage, embedding }
}

await saveCallMemory(sessionId, {
  summary: lorSummary,
  passages: [{ ...(await passageFor(lorSummary)), kind: "summary" }],
})

if (edited && first) {
  await saveEditedSummary(sessionId, {
    summary: correction,
    editedById: first.userId,
    passage: await passageFor(correction),
  })
}

console.log(`Seeded ${sessionId}${edited ? " (edited)" : ""}`)
process.exit(0)
