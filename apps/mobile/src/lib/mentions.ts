import { LOR_USER_ID } from "@repo/db/constants"
import type { WorkspaceMember } from "@/lib/api-types"

// @Lor in stored content: from chat or a human thread, the send starts a
// session.
export function mentionsLor(content: string) {
  return content.includes(`<@${LOR_USER_ID}>`)
}

// The session's first turn shows "@Lor" before the server's copy resolves
// its mentions (the bot user seeded in packages/db/src/seeds/lor.ts).
export const lorMention = { id: LOR_USER_ID, name: "Lor", image: null }

export type MentionCandidate = Pick<
  WorkspaceMember,
  "userId" | "name" | "image" | "isBot" | "status"
> & {
  avatarColor?: string | null
  id: string
  label: string
  search: string
}

export const everyoneMentionCandidate: MentionCandidate = {
  id: "everyone",
  userId: "everyone",
  name: "Everyone",
  image: null,
  isBot: false,
  status: "online",
  label: "everyone",
  search: "everyone all members workspace",
}

export const channelMentionCandidate: MentionCandidate = {
  id: "channel",
  userId: "channel",
  name: "Channel",
  image: null,
  isBot: false,
  status: "online",
  label: "channel",
  search: "channel all members notify",
}

export const hereMentionCandidate: MentionCandidate = {
  id: "here",
  userId: "here",
  name: "Here",
  image: null,
  isBot: false,
  status: "online",
  label: "here",
  search: "here online active now",
}

export const BROADCAST_MENTION_IDS = new Set(["everyone", "channel", "here"])

// @everyone is only offered in workspace-audience channels — the server
// rejects it in members-only channels, so the composer doesn't tempt it.
export function broadcastMentionCandidates(
  audience: "workspace" | "members" | undefined
): MentionCandidate[] {
  return [
    channelMentionCandidate,
    hereMentionCandidate,
    ...(audience === "workspace" ? [everyoneMentionCandidate] : []),
  ]
}

export function workspaceMemberToMentionCandidate(
  member: WorkspaceMember
): MentionCandidate {
  const label = member.name.trim() || "member"

  return {
    id: member.userId,
    userId: member.userId,
    name: member.name,
    image: member.image,
    avatarColor: member.avatarColor,
    isBot: member.isBot,
    status: member.status,
    label,
    search: label.toLocaleLowerCase(),
  }
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  limit = 8
) {
  const normalizedQuery = query.trim().replace(/^@/, "").toLocaleLowerCase()

  return candidates
    .filter(
      (candidate) =>
        !normalizedQuery || candidate.search.includes(normalizedQuery)
    )
    .slice(0, limit)
}
