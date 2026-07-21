import type { DM, DMMember } from "@/lib/api-types"
import type { MentionCandidate } from "@/lib/mentions"

export function dmMemberName(member: DMMember) {
  return (
    (member.displayUsername ?? member.username ?? member.name).trim() ||
    member.name
  )
}

export function dmDisplayName(dm: Pick<DM, "name" | "type" | "members">) {
  if (dm.type === "group_dm" && dm.name) return dm.name
  return dm.members.map(dmMemberName).join(", ") || "Direct message"
}

export function dmMemberToMentionCandidate(member: DMMember): MentionCandidate {
  const label = dmMemberName(member)
  return {
    id: member.id,
    userId: member.id,
    name: member.name,
    username: member.username,
    displayUsername: member.displayUsername,
    image: member.image,
    isBot: false,
    status: "offline",
    label,
    search: [label, member.name, member.username, member.displayUsername]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(),
  }
}
