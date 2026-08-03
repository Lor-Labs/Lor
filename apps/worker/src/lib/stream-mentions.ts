import { extractDirectMentionUserIds } from "@repo/messaging"
import type { RealtimeMessageMention } from "@repo/realtime-types"

export function updateStreamMentionState(args: {
  content: string
  delta: string
  replace?: boolean
  roster: RealtimeMessageMention[]
}) {
  const content = args.replace ? args.delta : args.content + args.delta
  const mentionedUserIds = extractDirectMentionUserIds(content)

  return {
    content,
    mentions: args.roster.filter((member) => mentionedUserIds.has(member.id)),
  }
}
