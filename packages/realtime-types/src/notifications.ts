export type NotificationConversationContext = {
  channelName: string | null
  workspaceName: string | null
}

export function buildNotificationConversationName(
  context: NotificationConversationContext
): string | null {
  const channelName = context.channelName ? `#${context.channelName}` : null

  if (channelName && context.workspaceName) {
    return `${channelName}, ${context.workspaceName}`
  }
  return channelName ?? context.workspaceName
}

export function buildNotificationTitle(input: {
  actorName: string
  channelName: string | null
  workspaceName: string | null
}): string {
  const conversationName = buildNotificationConversationName(input)
  return conversationName
    ? `${input.actorName} (${conversationName})`
    : input.actorName
}

export function buildReactionNotificationBody(input: {
  emoji: string
  messagePreview: string | null
}): string {
  return input.messagePreview
    ? `Reacted ${input.emoji} to your "${input.messagePreview}"`
    : `Reacted ${input.emoji} to your message`
}
