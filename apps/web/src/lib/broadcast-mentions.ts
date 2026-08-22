// Broadcast mention pseudo-candidates for composers. @channel pings everyone
// who can see the channel; @here narrows to whoever is online. @everyone is
// only offered in workspace-audience channels — the server rejects it in
// members-only channels (it means the whole workspace, and a private channel
// must never widen to it), so the composer doesn't tempt it.
export function broadcastMentionCandidates(
  audience: "workspace" | "members" | undefined
) {
  return [
    {
      id: "channel",
      label: "channel",
      name: "channel",
      search: "channel all members notify",
    },
    {
      id: "here",
      label: "here",
      name: "here",
      search: "here online active now",
    },
    ...(audience === "members"
      ? []
      : [
          {
            id: "everyone",
            label: "everyone",
            name: "everyone",
            search: "everyone all members workspace",
          },
        ]),
  ]
}
