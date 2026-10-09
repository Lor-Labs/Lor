export type WorkspaceMembersSidebarView = {
  type: "workspace-members"
  workspaceSlug: string
  channelId: string
}

export type ThreadSidebarView = {
  type: "thread"
  workspaceSlug: string
  channelId: string
  threadRootId: string
  /** Message to reveal when the thread was opened from search or a citation. */
  targetMessageId?: string
  composerDraft?: { id: string; text: string }
  /** A call's panel: its chat (the default) or its record (summary and
   * transcript). */
  callTab?: "chat" | "transcript"
  /** Moment in the call (ms from its start) to reveal in the transcript. */
  transcriptAtMs?: number
}

export type AttachmentsSidebarView = {
  type: "attachments"
  workspaceSlug: string
  channelId: string
  search?: string
  kind?: "artifact" | "upload"
}

export type LoopSidebarView = {
  type: "loop"
  workspaceSlug: string
  channelId: string
  loopId: string
}

export type LoopsListSidebarView = {
  type: "loops"
  workspaceSlug: string
  channelId: string
}

// A Lor session's context, plan, files and activity, beside the session page.
export type SessionWorkSidebarView = {
  type: "session-work"
  workspaceSlug: string
  channelId: string
  sessionId: string
  threadRootId: string
}

export type RightSidebarView =
  | WorkspaceMembersSidebarView
  | ThreadSidebarView
  | AttachmentsSidebarView
  | LoopSidebarView
  | LoopsListSidebarView
  | SessionWorkSidebarView
