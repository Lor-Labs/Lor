import { AutoSubscribe, type JobContext } from "@livekit/agents"
import * as deepgram from "@livekit/agents-plugin-deepgram"
import {
  type Participant,
  ParticipantKind,
  RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent,
  type TrackPublication,
  TrackSource,
} from "@livekit/rtc-node"
import { and, db, eq, isNull, schema } from "@repo/db"
import { CAPTION_ATTRIBUTES, CAPTION_TOPIC } from "@repo/voice"
import { recordCaptureGap } from "@repo/voice/server"
import { logger } from "./logger"
import { type Caption, MicStream, STT_MODEL } from "./mic-stream"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The room name is the voice_session id; human identities are
// voice_session_participant ids.
async function findLiveSession(sessionId: string) {
  const [row] = await db
    .select({ startedAt: schema.voiceSession.startedAt })
    .from(schema.voiceSession)
    .where(
      and(
        eq(schema.voiceSession.id, sessionId),
        isNull(schema.voiceSession.endedAt)
      )
    )
    .limit(1)
  return row ?? null
}

function isHumanMicrophone(
  publication: TrackPublication,
  participant: Participant
) {
  return (
    participant.kind === ParticipantKind.STANDARD &&
    UUID_PATTERN.test(participant.identity) &&
    publication.source === TrackSource.SOURCE_MICROPHONE
  )
}

// Sent on the speaker's behalf, so clients attribute the caption to them.
async function publishCaption(
  room: Room,
  identity: string,
  trackId: string,
  caption: Caption
) {
  if (!room.isConnected || !room.localParticipant) return
  const writer = await room.localParticipant.streamText({
    topic: CAPTION_TOPIC,
    senderIdentity: identity,
    attributes: {
      [CAPTION_ATTRIBUTES.trackId]: trackId,
      [CAPTION_ATTRIBUTES.segmentId]: caption.segmentId,
      [CAPTION_ATTRIBUTES.final]: String(caption.final),
    },
  })
  await writer.write(caption.text)
  await writer.close()
}

// One job per room: a Deepgram stream for each unmuted human microphone.
export async function transcribeRoom(ctx: JobContext, deepgramApiKey: string) {
  const sessionId = ctx.job.room?.name ?? ""
  const session = UUID_PATTERN.test(sessionId)
    ? await findLiveSession(sessionId)
    : null
  if (!session) {
    logger.warn({ room: sessionId }, "transcriber: no live session for room")
    ctx.shutdown("no live session")
    return
  }

  const speech = new deepgram.STT({
    apiKey: deepgramApiKey,
    model: STT_MODEL,
    language: "en",
    keyterm: ["Lor"],
    interimResults: true,
    punctuate: true,
    smartFormat: true,
  })
  const streams = new Map<string, MicStream>()
  const sessionMs = () => Date.now() - session.startedAt.getTime()

  const open = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    const trackId = publication.sid
    if (
      !trackId ||
      streams.has(trackId) ||
      publication.muted ||
      !isHumanMicrophone(publication, participant)
    ) {
      return
    }
    const stream = new MicStream({
      sessionId,
      participantId: participant.identity,
      trackId,
      track,
      speech,
      sessionStartedAt: session.startedAt,
      publishCaption: (caption) =>
        publishCaption(ctx.room, participant.identity, trackId, caption),
    })
    streams.set(trackId, stream)
    stream.start()
  }

  const close = (publication: TrackPublication) => {
    if (!publication.sid) return
    streams.get(publication.sid)?.close()
    streams.delete(publication.sid)
  }

  let reconnectingAtMs: number | null = null
  ctx.room
    .on(RoomEvent.TrackSubscribed, open)
    .on(RoomEvent.TrackUnsubscribed, (_track, publication) =>
      close(publication)
    )
    .on(RoomEvent.TrackMuted, (publication) => close(publication))
    .on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (!(participant instanceof RemoteParticipant) || !publication.sid) {
        return
      }
      const remote = participant.trackPublications.get(publication.sid)
      if (remote?.track) open(remote.track, remote, participant)
    })
    // Audio stops while the transcriber reconnects, for everyone at once.
    .on(RoomEvent.Reconnecting, () => {
      reconnectingAtMs ??= sessionMs()
    })
    .on(RoomEvent.Reconnected, () => {
      if (reconnectingAtMs === null) return
      const startMs = reconnectingAtMs
      reconnectingAtMs = null
      void recordCaptureGap({
        sessionId,
        participantId: null,
        startMs,
        endMs: sessionMs(),
        reason: "transcriber_restart",
      }).catch((err: unknown) =>
        logger.error({ err }, "transcriber: gap write failed")
      )
    })

  ctx.addShutdownCallback(async () => {
    for (const stream of streams.values()) stream.close()
    streams.clear()
    await speech.close()
  })

  await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)
  logger.info({ sessionId }, "transcriber: joined")
}
