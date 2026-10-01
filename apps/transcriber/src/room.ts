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
import {
  CAPTION_ATTRIBUTES,
  CAPTION_TOPIC,
  VOICE_SESSION_GRACE_MS,
} from "@repo/voice"
import {
  claimTranscriber,
  recordCaptureGap,
  releaseTranscriber,
  renewTranscriber,
  TRANSCRIBER_HEARTBEAT_MS,
} from "@repo/voice/server"
import { logger } from "./logger"
import { LorListener } from "./lor-listener"
import { type Caption, MicStream, STT_MODEL } from "./mic-stream"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Past the grace period plus the 30s end sweep, so the session has ended
// and a rejoin starts a new room, which gets its own transcriber.
const LEAVE_EMPTY_ROOM_MS = VOICE_SESSION_GRACE_MS + 60_000

// The room name is the voice_session id; human identities are
// voice_session_participant ids.
function isHuman(participant: Participant) {
  return (
    participant.kind === ParticipantKind.STANDARD &&
    UUID_PATTERN.test(participant.identity)
  )
}

function isHumanMicrophone(
  publication: TrackPublication,
  participant: Participant
) {
  return (
    isHuman(participant) && publication.source === TrackSource.SOURCE_MICROPHONE
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
  const jobId = ctx.job.id
  const session = UUID_PATTERN.test(sessionId)
    ? await claimTranscriber(sessionId, jobId)
    : null
  if (!session) {
    logger.warn(
      { room: sessionId },
      "transcriber: session ended or already has a transcriber"
    )
    ctx.shutdown("not needed")
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
  const finishing = new Set<Promise<void>>()
  const listener = new LorListener(sessionId)
  let audioSeconds = 0
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
      onHeard: (line) =>
        listener.hear(
          participant.identity,
          participant.name || "Someone",
          line
        ),
      onAudioSent: (seconds) => {
        audioSeconds += seconds
      },
    })
    streams.set(trackId, stream)
    stream.start()
  }

  const close = (trackId: string | undefined) => {
    const stream = trackId ? streams.get(trackId) : undefined
    if (!trackId || !stream) return
    streams.delete(trackId)
    const done = stream.finish().finally(() => finishing.delete(done))
    finishing.add(done)
  }

  // The lease is held while people are in the call. An empty room releases
  // it, so the stretch until someone returns isn't recorded as missed.
  let holding = true
  let leaveTimer: ReturnType<typeof setTimeout> | undefined
  const logLeaseError = (err: unknown) =>
    logger.error({ err, sessionId }, "transcriber: lease write failed")
  const onEmpty = () => {
    holding = false
    void releaseTranscriber(sessionId, jobId).catch(logLeaseError)
    leaveTimer = setTimeout(
      () => ctx.shutdown("call empty"),
      LEAVE_EMPTY_ROOM_MS
    )
  }
  const onHumanJoined = async () => {
    clearTimeout(leaveTimer)
    if (holding) return
    if (await claimTranscriber(sessionId, jobId)) holding = true
    else ctx.shutdown("another transcriber took over")
  }
  const heartbeat = setInterval(() => {
    if (!holding) return
    void renewTranscriber(sessionId, jobId)
      .then((kept) => {
        if (!kept && holding) ctx.shutdown("another transcriber took over")
      })
      .catch(logLeaseError)
  }, TRANSCRIBER_HEARTBEAT_MS)
  const humanCount = () =>
    [...ctx.room.remoteParticipants.values()].filter(isHuman).length

  let reconnectingAtMs: number | null = null
  ctx.room
    .on(RoomEvent.ParticipantConnected, (participant) => {
      if (isHuman(participant)) void onHumanJoined().catch(logLeaseError)
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (isHuman(participant) && humanCount() === 0) onEmpty()
    })
    .on(RoomEvent.TrackSubscribed, open)
    .on(RoomEvent.TrackUnsubscribed, (_track, publication) =>
      close(publication.sid)
    )
    .on(RoomEvent.TrackMuted, (publication) => close(publication.sid))
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

  // Runs after the room disconnects: captions stop, but final transcripts
  // still arrive and are saved.
  ctx.addShutdownCallback(async () => {
    clearInterval(heartbeat)
    clearTimeout(leaveTimer)
    for (const trackId of [...streams.keys()]) close(trackId)
    await Promise.all(finishing)
    await listener.close()
    await speech.close()
    // Compare with Deepgram's billed minutes for the call.
    logger.info(
      { sessionId, sttMinutes: Number((audioSeconds / 60).toFixed(2)) },
      "transcriber: left"
    )
  })

  await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)
  if (humanCount() === 0) onEmpty()
  logger.info({ sessionId }, "transcriber: joined")
}
