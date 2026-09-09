import type { InfiniteData } from "@tanstack/react-query"
import type { Message } from "@/lib/api-types"

interface PageWithMessages<T> {
  data: T[]
}

/**
 * Applies an updater function to messages across all pages in an infinite query.
 * Used by hooks that modify the messages cache (delete, edit, react, pin).
 */
export function updateMessagesAcrossPages<
  TPage extends PageWithMessages<TPage["data"][number]>,
>(
  infiniteData: InfiniteData<TPage>,
  updater: (messages: TPage["data"]) => TPage["data"]
): InfiniteData<TPage> {
  return {
    ...infiniteData,
    pages: infiniteData.pages.map((page) => ({
      ...page,
      data: updater(page.data),
    })),
  }
}

// Pending rows do not persist live deltas. Refetches must not erase the stream
// or undo a terminal frame received while the HTTP request was in flight.
export function preserveMessageStream(
  message: Message,
  cached?: Message
): Message {
  if (
    message.status !== "pending" ||
    !cached ||
    (!cached.streaming &&
      cached.status !== "complete" &&
      cached.status !== "failed")
  )
    return message
  return {
    ...message,
    status: cached.status,
    content: cached.content,
    streaming: cached.streaming,
    merlinReasoning: cached.merlinReasoning,
    merlinReasoningSegments: cached.merlinReasoningSegments,
    merlinToolCalls: cached.merlinToolCalls,
    remembered: cached.remembered,
    mentions: cached.mentions,
    steeringBy: cached.steeringBy,
  }
}
