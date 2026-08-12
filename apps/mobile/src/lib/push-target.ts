export type PushTarget =
  | {
      kind: "message"
      channelId: string
      workspaceId: string | null
      threadRootId: string | null
      messageId: string | null
    }
  | {
      kind: "instructions-proposal"
      workspaceId: string
      workspaceSlug: string
    }

export function parsePushTarget(
  data: Record<string, unknown>
): PushTarget | null {
  if (data.type === "instructions-proposal") {
    const workspaceId =
      typeof data.workspaceId === "string" ? data.workspaceId : null
    const workspaceSlug =
      typeof data.workspaceSlug === "string" ? data.workspaceSlug : null
    if (!workspaceId || !workspaceSlug) return null
    return { kind: "instructions-proposal", workspaceId, workspaceSlug }
  }

  const channelId = typeof data.channelId === "string" ? data.channelId : null
  if (!channelId) return null

  return {
    kind: "message",
    channelId,
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : null,
    threadRootId:
      typeof data.threadRootId === "string" ? data.threadRootId : null,
    messageId: typeof data.messageId === "string" ? data.messageId : null,
  }
}
