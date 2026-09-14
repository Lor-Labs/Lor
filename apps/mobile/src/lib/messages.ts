import type {
  RealtimeMessage,
  RealtimeMessageReactionUpdated,
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

// Client-generated nonce ids (`mobile-…`) mark sends awaiting server ack.
export function isOptimisticMessage(message: Message) {
  return message.id.startsWith("mobile-")
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

export function updateMessageContent(
  messages: Message[],
  messageId: string,
  content: string,
  editedAt: string,
  mentions?: Message["mentions"]
) {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content,
          editedAt,
          mentions: mentions ?? message.mentions,
        }
      : message
  )
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

export function applyReactionUpdate(
  message: Message,
  update: RealtimeMessageReactionUpdated,
  currentUserId?: string
): Message {
  if (message.id !== update.messageId) return message
  const reactions = [...(message.reactions ?? [])]
  const index = reactions.findIndex(
    (reaction) => reaction.emoji === update.emoji
  )
  if (update.count <= 0) {
    if (index >= 0) reactions.splice(index, 1)
    return { ...message, reactions }
  }

  const current = index >= 0 ? reactions[index] : undefined
  const reactors = [...(current?.reactors ?? [])]
  const actorIndex = reactors.findIndex(
    (reactor) => reactor.id === update.actorUserId
  )
  if (update.reactedByActor && actorIndex < 0) {
    reactors.push({ id: update.actorUserId, name: update.actorName })
  } else if (!update.reactedByActor && actorIndex >= 0) {
    reactors.splice(actorIndex, 1)
  }
  const nextReaction = {
    emoji: update.emoji,
    count: update.count,
    reactedByCurrentUser:
      currentUserId === update.actorUserId
        ? update.reactedByActor
        : (current?.reactedByCurrentUser ?? false),
    reactors,
  }
  if (index >= 0) reactions[index] = nextReaction
  else reactions.push(nextReaction)
  return { ...message, reactions }
}

export function realtimeMessageToMessage(message: RealtimeMessage): Message {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    content: message.content,
    type: message.type,
    eventType: message.eventType ?? null,
    eventPayload: message.eventPayload ?? null,
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
    lorReasoning: null,
    lorReasoningSegments: [],
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
  referencedMessage = null,
  attachments = [],
}: {
  nonce: string
  channelId: string
  content: string | null
  author: {
    id: string
    name: string
    image?: string | null
  }
  threadRootId?: string | null
  referencedMessage?: NonNullable<Message["referencedMessage"]> | null
  attachments?: NonNullable<Message["attachments"]>
}): Message {
  return {
    id: nonce,
    channelId,
    authorId: author.id,
    content,
    type: referencedMessage ? "reply" : "default",
    eventType: null,
    eventPayload: null,
    status: "complete",
    createdAt: new Date().toISOString(),
    author: {
      id: author.id,
      name: author.name,
      image: author.image ?? null,
    },
    referencedMessageId: referencedMessage?.id ?? null,
    referencedMessage,
    attachments,
    embeds: [],
    pinned: false,
    editedAt: null,
    mentions: [],
    reactions: [],
    threadRootId,
    threadSummary: null,
    lorReasoning: null,
    lorReasoningSegments: [],
    overrideName: null,
    overrideAvatarUrl: null,
  }
}
