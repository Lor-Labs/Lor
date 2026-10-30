import { and, db, eq, isNotNull, isNull } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import { voiceSession, voiceSessionParticipant } from "@repo/db/schema"
import { userConnectionRoom, userRoom } from "@repo/realtime-types"
import {
  getLiveKitConfig,
  markParticipantLeft,
  removeFromRoom,
} from "@repo/voice/server"
import { publishRealtime } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// Called after someone loses access (project removal, workspace kick).
export async function disconnectUserSockets(userId: string) {
  await publishRealtime((io) => {
    io.to([userConnectionRoom(userId), userRoom(userId)]).disconnectSockets(
      true
    )
  })
  await removeFromInaccessibleCalls(userId).catch((err) =>
    logger.warn({ err, userId }, "Removing a user from live calls failed")
  )
}

// A LiveKit connection outlives the socket: drop the user from live calls in
// channels they can no longer see.
async function removeFromInaccessibleCalls(userId: string) {
  const livekit = getLiveKitConfig()
  if (!livekit) return
  const live = await db
    .select({
      sessionId: voiceSession.id,
      channelId: voiceSession.channelId,
      participantId: voiceSessionParticipant.id,
    })
    .from(voiceSessionParticipant)
    .innerJoin(
      voiceSession,
      eq(voiceSession.id, voiceSessionParticipant.sessionId)
    )
    .where(
      and(
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt),
        isNull(voiceSession.endedAt)
      )
    )
  for (const call of live) {
    if ((await resolveChannelAccess(userId, call.channelId)).ok) continue
    await removeFromRoom(livekit, call.sessionId, call.participantId)
    await markParticipantLeft(call.sessionId, {
      participantId: call.participantId,
    })
  }
}
