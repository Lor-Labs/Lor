import {
  MARKDOWN_USER_MENTION_REGEX,
  USER_MENTION_REGEX,
} from "@repo/realtime-types/mentions"

export { MARKDOWN_USER_MENTION_REGEX, USER_MENTION_REGEX }

export function extractDirectMentionUserIds(content: string) {
  const userIds = new Set<string>()

  for (const match of content.matchAll(USER_MENTION_REGEX)) {
    const userId = match[1]
    if (userId) userIds.add(userId)
  }

  for (const match of content.matchAll(MARKDOWN_USER_MENTION_REGEX)) {
    const userId = match[1]
    if (userId) userIds.add(userId)
  }

  return userIds
}
