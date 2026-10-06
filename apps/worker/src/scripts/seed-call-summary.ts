// Dev only: gives an ended call a made-up summary, its search passage, and
// Lor's recap in the call chat, so the summary UI can be seen without
// running the after-call job (reference/voice-channels-runbook.md V7). The
// content is fake on purpose and never reads the transcript; item times are
// spread across the call's length. The recap is inserted without
// notifications. Re-running replaces the summary and skips the recap.
//
//   pnpm --filter @repo/worker exec tsx src/scripts/seed-call-summary.ts <sessionId> [--edited]
//
// --edited also records a correction by the first person who joined, so
// "Edited by" shows.
import { and, asc, db, eq, LOR_USER_ID, schema } from "@repo/db"
import type { VoiceSessionSummary } from "@repo/db/schema"
import { embedDocumentsWithUsage } from "@repo/lor/embeddings"
import {
  saveCallMemory,
  saveEditedSummary,
  summaryPassageFor,
  summaryText,
} from "@repo/voice/server"

const RECAP_NOTE =
  "I indexed this call's transcript, so you can ask me about it later."

const [sessionId] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const edited = process.argv.includes("--edited")
if (!sessionId) {
  console.error("Pass a session id")
  process.exit(1)
}

const [call] = await db
  .select({
    channelId: schema.voiceSession.channelId,
    threadRootId: schema.voiceSession.threadRootId,
    startedAt: schema.voiceSession.startedAt,
    endedAt: schema.voiceSession.endedAt,
  })
  .from(schema.voiceSession)
  .where(eq(schema.voiceSession.id, sessionId))
  .limit(1)
if (!call?.endedAt) {
  console.error("No ended call with that id")
  process.exit(1)
}
const endedAt = call.endedAt
const length = endedAt.getTime() - call.startedAt.getTime()
const at = (fraction: number) => Math.round(length * fraction)

const lorSummary: VoiceSessionSummary = {
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
      text: "Should correcting a summary also update Lor's recap in the call chat?",
      atMs: at(0.62),
    },
  ],
  followUps: [
    {
      text: "Write the release notes for voice channels by Friday.",
      atMs: at(0.78),
    },
    { text: "Run a full team call on phones before launch.", atMs: at(0.9) },
  ],
}

const correction: VoiceSessionSummary = {
  summary:
    "The team reviewed the voice channels launch. They agreed to ship call summaries and Lor's answers about past calls in the next release, with the summary shown above the transcript, and to keep approvals desktop-only until the phone app has the call pill.",
  decisions: [
    ...lorSummary.decisions,
    {
      text: "Show the summary at the top of the transcript instead of in its own tab.",
      atMs: at(0.62),
    },
  ],
  openQuestions: [],
  followUps: [
    ...lorSummary.followUps,
    { text: "Check how long summaries look on a laptop screen.", atMs: null },
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

if (call.threadRootId) {
  const [recap] = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.threadRootId, call.threadRootId),
        eq(schema.message.authorId, LOR_USER_ID)
      )
    )
    .limit(1)
  if (!recap) {
    await db.insert(schema.message).values({
      channelId: call.channelId,
      authorId: LOR_USER_ID,
      content: `${summaryText(lorSummary)}\n\n${RECAP_NOTE}`,
      threadRootId: call.threadRootId,
      createdAt: new Date(endedAt.getTime() + 40_000),
    })
  }
}

if (edited) {
  const [first] = await db
    .select({ userId: schema.voiceSessionParticipant.userId })
    .from(schema.voiceSessionParticipant)
    .where(eq(schema.voiceSessionParticipant.sessionId, sessionId))
    .orderBy(asc(schema.voiceSessionParticipant.firstJoinedAt))
    .limit(1)
  if (first) {
    await saveEditedSummary(sessionId, {
      summary: correction,
      editedById: first.userId,
      passage: await passageFor(correction),
    })
  }
}

console.log(`Seeded ${sessionId}${edited ? " (edited)" : ""}`)
process.exit(0)
