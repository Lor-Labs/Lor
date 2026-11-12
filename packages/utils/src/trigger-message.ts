// Webhook Act turns store the rendered message, then a titled copy and the
// raw request (connector-triggers.ts). Recover the message for old sessions
// too. Unknown formats and batches keep their complete saved content.
export function triggerMessageContent(content: string | null): string | null {
  if (!content?.trim()) return null
  const prefix = "Event: data_received\n\n"
  if (!content.startsWith(prefix)) return content

  const rawStart = content.lastIndexOf("\n\nRaw payload:\n")
  const body = content.slice(
    prefix.length,
    rawStart >= prefix.length ? rawStart : undefined
  )
  const titleStart = body.indexOf("\n\nTitle: ")
  if (titleStart < 0) return content
  const titleEnd = body.indexOf("\n", titleStart + 2)
  if (titleEnd < 0) return content

  const message = body.slice(0, titleStart)
  const copy = body.slice(titleEnd + 1)
  // The item's copy can be capped; the first copy is the original message.
  return copy.trim() && message.startsWith(copy) ? message : content
}

// Use the clients' complete message renderers, with actions disabled by the
// context view. The automation's event remains the transcript row's anchor.
export function restoreTriggerMessage<
  Event,
  Source extends { author: { id: string } },
>(event: Event, source: Source) {
  return {
    ...event,
    ...source,
    authorId: source.author.id,
    type: "default" as const,
    status: "complete" as const,
    eventType: null,
    eventPayload: null,
    threadRootId: null,
    referencedMessageId: null,
    referencedMessage: null,
    forwarded: null,
    pinned: false,
    editedAt: null,
    reactions: [],
    routedToLor: null,
    threadSummary: null,
    lorReasoning: null,
    lorReasoningSegments: [],
    lorToolCalls: [],
    lorTriggerMessageId: null,
    lorRun: null,
  }
}
