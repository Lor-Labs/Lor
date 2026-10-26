export type WorkspaceMembersSidebarView = {
  type: "workspace-members"
  workspaceSlug: string
  channelId: string
}

// A call's panel tabs. Summary exists once the call has ended.
export type CallTab = "summary" | "chat" | "transcript"

export type ThreadSidebarView = {
  type: "thread"
  workspaceSlug: string
  channelId: string
  threadRootId: string
  /** Message to reveal when the thread was opened from search or a citation. */
  targetMessageId?: string
  composerDraft?: { id: string; text: string }
  /** A call's panel tab. Unset: Summary for an ended call, else Chat. */
  callTab?: CallTab
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

// Everyone's sessions in a channel, active or archived.
export type SessionsListSidebarView = {
  type: "sessions"
  workspaceSlug: string
  channelId: string
  filter: "active" | "archived"
}

// A Lor session's context, plan, files and activity, beside the session page.
export type SessionWorkSidebarView = {
  type: "session-work"
  workspaceSlug: string
  channelId: string
  sessionId: string
  threadRootId: string
}

// A code session's changes against its base branch, staged or not, beside
// the session page.
export type SessionChangesSidebarView = {
  type: "session-changes"
  workspaceSlug: string
  channelId: string
  sessionId: string
  threadRootId: string
}

// A code session's repository files, beside the session page.
export type SessionFilesSidebarView = {
  type: "session-files"
  workspaceSlug: string
  channelId: string
  sessionId: string
  threadRootId: string
  revealFolder?: { id: string; path: string }
}

export type RightSidebarView =
  | WorkspaceMembersSidebarView
  | ThreadSidebarView
  | AttachmentsSidebarView
  | LoopSidebarView
  | LoopsListSidebarView
  | SessionsListSidebarView
  | SessionWorkSidebarView
  | SessionChangesSidebarView
  | SessionFilesSidebarView
