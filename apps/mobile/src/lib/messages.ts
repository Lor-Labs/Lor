import type {
  RealtimeMessage,
  RealtimeMessageThreadUpdated,
} from "@repo/realtime-types"
import type { Message } from "@/lib/api-types"

export function mergeMessages(...groups: Message[][]) {
  const byId = new Map<string, Message>()
  for (const group of groups) {
    for (const message of group) {
      if (!byId.has(message.id)) byId.set(message.id, message)
    }
  }

  return [...byId.values()].sort((left, right) => {
    const timeDifference =
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    return timeDifference || right.id.localeCompare(left.id)
  })
}

export function replaceMessage(
  messages: Message[],
  messageId: string,
  replacement: Message
) {
  return mergeMessages(
    [replacement],
    messages.filter((message) => message.id !== messageId)
  )
}

export function removeMessage(messages: Message[], messageId: string) {
  return messages.filter((message) => message.id !== messageId)
}

export function rollbackOptimisticReply(
  messages: Message[],
  messageId: string,
  totalReplyCount: number
) {
  return {
    messages: removeMessage(messages, messageId),
    totalReplyCount: Math.max(0, totalReplyCount - 1),
  }
}

export function applyThreadSummaryUpdate(
  messages: Message[],
  update: RealtimeMessageThreadUpdated
) {
  const threadSummary =
    update.replyCount === 0 || !update.lastReplyAt
      ? null
      : {
          replyCount: update.replyCount,
          lastReplyAt: update.lastReplyAt,
          participants: update.participants,
        }

  return messages.map((message) =>
    message.id === update.threadRootId ? { ...message, threadSummary } : message
  )
}

export function realtimeMessageToMessage(message: RealtimeMessage): Message {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    content: message.content,
    type: message.type,
    status: message.status ?? (message.streaming ? "pending" : "complete"),
    createdAt: message.createdAt,
    author: message.author,
    referencedMessageId: message.referencedMessage?.id ?? null,
    referencedMessage: message.referencedMessage ?? null,
    attachments: message.attachments ?? [],
    embeds: message.embeds ?? [],
    pinned: message.pinned,
    editedAt: message.editedAt ?? null,
    mentions: message.mentions,
    reactions: message.reactions,
    threadRootId: message.threadRootId ?? null,
    threadSummary: null,
    merlinReasoning: null,
    merlinReasoningSegments: [],
    overrideName: message.overrideName ?? null,
    overrideAvatarUrl: message.overrideAvatarUrl ?? null,
  }
}

export function createOptimisticMessage({
  nonce,
  channelId,
  content,
  author,
  threadRootId = null,
}: {
  nonce: string
  channelId: string
  content: string
  author: {
    id: string
    name: string
    username?: string | null
    displayUsername?: string | null
    image?: string | null
  }
  threadRootId?: string | null
}): Message {
  return {
    id: nonce,
    channelId,
    authorId: author.id,
    content,
    type: "default",
    status: "complete",
    createdAt: new Date().toISOString(),
    author: {
      id: author.id,
      name: author.name,
      username: author.username ?? null,
      displayUsername: author.displayUsername ?? null,
      image: author.image ?? null,
    },
    referencedMessageId: null,
    referencedMessage: null,
    attachments: [],
    embeds: [],
    pinned: false,
    editedAt: null,
    mentions: [],
    reactions: [],
    threadRootId,
    threadSummary: null,
    merlinReasoning: null,
    merlinReasoningSegments: [],
    overrideName: null,
    overrideAvatarUrl: null,
  }
}
