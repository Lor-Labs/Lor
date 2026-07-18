import type { WorkspaceMember } from "@/lib/api-types"

export type MentionCandidate = Pick<
  WorkspaceMember,
  | "userId"
  | "name"
  | "username"
  | "displayUsername"
  | "image"
  | "isBot"
  | "status"
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
  username: "everyone",
  displayUsername: "everyone",
  image: null,
  isBot: false,
  status: "online",
  label: "everyone",
  search: "everyone all members workspace",
}

export function workspaceMemberToMentionCandidate(
  member: WorkspaceMember
): MentionCandidate {
  const label =
    (member.displayUsername ?? member.username ?? member.name).trim() ||
    "member"

  return {
    id: member.userId,
    userId: member.userId,
    name: member.name,
    username: member.username,
    displayUsername: member.displayUsername,
    image: member.image,
    avatarColor: member.avatarColor,
    isBot: member.isBot,
    status: member.status,
    label,
    search: [label, member.name, member.username, member.displayUsername]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(),
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
