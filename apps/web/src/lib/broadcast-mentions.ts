const BROADCAST_MENTION_IDS: ReadonlySet<string> = new Set(["chat", "here"])

export function isBroadcastMention(id: string) {
  return BROADCAST_MENTION_IDS.has(id)
}

// The group mentions a composer offers: @chat pings everyone in the chat,
// @here those of them online now (packages/messaging). There is no
// @everyone or @channel: a group chat has no wider audience to ping. No
// search terms: the @ menu offers one only for a prefix of its name.
export function broadcastMentionCandidates() {
  return [
    { id: "chat", label: "chat", name: "chat", image: null },
    { id: "here", label: "here", name: "here", image: null },
  ]
}
