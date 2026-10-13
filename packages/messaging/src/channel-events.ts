// Plain-text rendering of a channel event, stored as the message content.
// Clients render events from eventType/eventPayload; this string is the
// search + stale-client fallback, so it must always read as a full sentence.

export type ChannelEventContentInput =
  | {
      eventType: "channel_created"
      actorName: string
      viaProposal?: boolean
      originChannelName?: string
    }
  | {
      eventType: "channel_renamed"
      actorName: string
      from: string
      to: string
    }
  | { eventType: "member_added"; actorName: string; memberNames: string[] }
  | { eventType: "member_removed"; actorName: string; memberName: string }
  | { eventType: "member_left"; actorName: string }
  | {
      eventType: "loop_created"
      actorName: string
      loopName: string
      viaProposal?: boolean
    }
  | {
      eventType: "loop_paused"
      loopName: string
      reason: "failures" | "out_of_credits"
    }
  | { eventType: "loop_completed"; actorName: string; loopName: string }
  | { eventType: "loop_run"; loopName: string }

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export function channelEventContent(input: ChannelEventContentInput): string {
  switch (input.eventType) {
    case "channel_created":
      if (input.viaProposal) {
        return input.originChannelName
          ? `${input.actorName} created this channel from an approved change proposal in #${input.originChannelName}`
          : `${input.actorName} created this channel from an approved change proposal`
      }
      return `${input.actorName} created this channel`
    case "channel_renamed":
      return `${input.actorName} renamed the channel from #${input.from} to #${input.to}`
    case "member_added":
      return `${input.actorName} added ${joinNames(input.memberNames)}`
    case "member_removed":
      return `${input.actorName} removed ${input.memberName}`
    case "member_left":
      return `${input.actorName} left the channel`
    case "loop_created":
      return input.viaProposal
        ? `${input.actorName} created the loop "${input.loopName}" from an approved change proposal`
        : `${input.actorName} created the loop "${input.loopName}"`
    case "loop_paused":
      return input.reason === "out_of_credits"
        ? `The loop "${input.loopName}" was paused — out of credits`
        : `The loop "${input.loopName}" was paused after repeated failures`
    case "loop_completed":
      return `${input.actorName} completed the loop "${input.loopName}"`
    case "loop_run":
      return `The loop "${input.loopName}" ran on schedule`
  }
}
