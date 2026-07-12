import type { RealtimeMessage } from "@repo/realtime-types"
import type { Message } from "@/lib/api-types"

export function realtimeMessageToMessage(message: RealtimeMessage): Message {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    content: message.content,
    type: message.type,
    status: message.status ?? "complete",
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
    overrideName: message.overrideName ?? null,
    overrideAvatarUrl: message.overrideAvatarUrl ?? null,
  }
}

export function createOptimisticMessage({
  nonce,
  channelId,
  content,
  author,
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
    threadRootId: null,
    threadSummary: null,
    merlinReasoning: null,
    overrideName: null,
    overrideAvatarUrl: null,
  }
}
