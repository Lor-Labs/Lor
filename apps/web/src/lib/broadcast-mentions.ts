const BROADCAST_MENTION_IDS: ReadonlySet<string> = new Set([
  "channel",
  "here",
  "everyone",
])

export function isBroadcastMention(id: string) {
  return BROADCAST_MENTION_IDS.has(id)
}

// Broadcast mention pseudo-candidates for composers. @channel pings everyone
// who can see the channel; @here narrows to whoever is online. @everyone is
// only offered in workspace-audience channels — the server rejects it in
// members-only channels (it means the whole workspace, and a private channel
// must never widen to it), so the composer doesn't tempt it. No search terms:
// the @ menu offers a broadcast only for a prefix of its name.
export function broadcastMentionCandidates(
  audience: "workspace" | "members" | undefined
) {
  return [
    { id: "channel", label: "channel", name: "channel", image: null },
    { id: "here", label: "here", name: "here", image: null },
    // Only when the audience is known to be workspace-wide — an undefined
    // audience must not offer it.
    ...(audience === "workspace"
      ? [{ id: "everyone", label: "everyone", name: "everyone", image: null }]
      : []),
  ]
}
