// Who is in each voice channel's call, as web and mobile show it under the
// channel. Shared so both clients show their own join the same way.

export type VoicePresenceParticipant = {
  userId: string
  name: string
  image: string | null
  avatarColor: string | null
  connected: boolean
}

export type VoicePresenceChannel = {
  channelId: string
  sessionId: string
  participants: VoicePresenceParticipant[]
}

// "Ana is here", "Ana and Ben are here", "Ana, Ben, and Cy are here",
// "Ana, Ben, and 3 others are here".
export function whoIsHere(names: string[]) {
  const [first, second, third] = names
  if (!first) return ""
  if (!second) return `${first} is here`
  if (!third) return `${first} and ${second} are here`
  if (names.length === 3) return `${first}, ${second}, and ${third} are here`
  return `${first}, ${second}, and ${names.length - 2} others are here`
}

// This device's user before the server knows: in the call being joined or
// in, or gone from the call just left.
export type OwnVoicePresence =
  | { left: false; channelId: string; participant: VoicePresenceParticipant }
  | { left: true; channelId: string; userId: string }

type ChannelPresence = Pick<VoicePresenceChannel, "channelId" | "participants">

// The server only learns of a join or leave from LiveKit (a webhook, or the
// leave request's push), a moment later, so this device's own moves show
// from the tap. Derived rather than written to the cache, so a refetch landing
// first can't undo them; once the server lists the person, its entry (with
// their real colour) wins. Joining here moves the call off any other device,
// so they're shown nowhere else.
export function withOwnVoicePresence(
  channels: ChannelPresence[],
  own: OwnVoicePresence | null
): ChannelPresence[] {
  if (!own) return channels
  if (own.left) {
    return channels
      .map((channel) =>
        channel.channelId === own.channelId
          ? {
              ...channel,
              participants: channel.participants.filter(
                (participant) => participant.userId !== own.userId
              ),
            }
          : channel
      )
      .filter((channel) => channel.participants.length > 0)
  }
  const { userId } = own.participant
  const elsewhere = channels
    .map((channel) =>
      channel.channelId === own.channelId
        ? channel
        : {
            ...channel,
            participants: channel.participants.filter(
              (participant) => participant.userId !== userId
            ),
          }
    )
    .filter((channel) => channel.participants.length > 0)
  const current = elsewhere.find(
    (channel) => channel.channelId === own.channelId
  )
  if (!current) {
    return [
      ...elsewhere,
      { channelId: own.channelId, participants: [own.participant] },
    ]
  }
  if (
    current.participants.some(
      (participant) => participant.userId === userId && participant.connected
    )
  ) {
    return elsewhere
  }
  return elsewhere.map((channel) =>
    channel === current
      ? {
          ...channel,
          participants: [
            ...channel.participants.filter(
              (participant) => participant.userId !== userId
            ),
            own.participant,
          ],
        }
      : channel
  )
}
