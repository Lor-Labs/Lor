import { LOR_USER_ID } from "@repo/db/constants"
import type { CreatureId } from "@repo/utils/bestiary"
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
  // Lor under a channel: its agent's creature, drawn in place of an avatar.
  creature?: CreatureId
  id: string
  label: string
  search: string
}

export const chatMentionCandidate: MentionCandidate = {
  id: "chat",
  userId: "chat",
  name: "Chat",
  image: null,
  isBot: false,
  status: "online",
  label: "chat",
  search: "chat all everyone notify",
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

export const BROADCAST_MENTION_IDS = new Set(["chat", "here"])

// The group mentions: @chat pings everyone in the chat, @here those of them
// online now. There is no @everyone or @channel (packages/messaging).
export function broadcastMentionCandidates(): MentionCandidate[] {
  return [chatMentionCandidate, hereMentionCandidate]
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
