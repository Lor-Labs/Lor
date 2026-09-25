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

export type RightSidebarView =
  | WorkspaceMembersSidebarView
  | ThreadSidebarView
  | AttachmentsSidebarView
  | LoopSidebarView
  | LoopsListSidebarView
