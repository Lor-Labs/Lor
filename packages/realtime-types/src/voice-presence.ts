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

export type OwnVoiceCall = {
  channelId: string
  sessionId: string
  participant: VoicePresenceParticipant
}

// This device's call, shown the moment it joins: the server only learns of a
// join from LiveKit's webhook, a moment later. Derived rather than written to
// the cache, so a refetch landing before the webhook can't drop it; once the
// server lists the person, its entry (with their real colour) wins. Joining
// here moves the call off any other device, so they're shown nowhere else.
export function withOwnVoiceCall(
  channels: VoicePresenceChannel[],
  own: OwnVoiceCall | null
): VoicePresenceChannel[] {
  if (!own) return channels
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
      {
        channelId: own.channelId,
        sessionId: own.sessionId,
        participants: [own.participant],
      },
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
