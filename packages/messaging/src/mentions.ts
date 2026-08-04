export const USER_MENTION_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi
export const MARKDOWN_USER_MENTION_REGEX =
  /\[@[^\]]*?\bid="([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"[^\]]*]/gi

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
