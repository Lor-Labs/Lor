import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

export function useArtifactConversation() {
  const navigate = useNavigate()
  const { workspaceSlug } = useParams({ strict: false })
  const { setView, clearView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const isMobile = useIsMobile()

  return (args: {
    artifactId: string
    channelId: string
    conversation?: {
      messageId: string
      threadRootId: string | null
      sessionId: string | null
    } | null
    showConversation?: boolean
    from?: "files"
    fileSearch?: string
  }) => {
    if (!workspaceSlug) return
    const source = args.conversation
    // A session's conversation is its page, never the thread panel.
    if (source?.sessionId && args.showConversation) {
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId: source.sessionId },
        search: { artifactId: args.artifactId },
      })
      return
    }
    const showThread =
      source && !source.sessionId && (args.showConversation || !isMobile)
    if (showThread) {
      const threadRootId = source.threadRootId ?? source.messageId
      setView({
        type: "thread",
        workspaceSlug,
        channelId: args.channelId,
        threadRootId,
        targetMessageId: source.messageId,
      })
      if (isCollapsed) toggleCollapsed()
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: args.channelId },
        search: (prev) => ({
          ...prev,
          artifactId: args.artifactId,
          artifactFrom: args.from ?? prev.artifactFrom,
          fileSearch: args.fileSearch ?? prev.fileSearch,
          threadId: threadRootId,
          threadMessageId: source.messageId,
        }),
      })
    } else {
      if (isMobile) clearView()
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: args.channelId },
        search: (prev) => ({
          ...prev,
          artifactId: args.artifactId,
          artifactFrom: args.from ?? prev.artifactFrom,
          fileSearch: args.fileSearch ?? prev.fileSearch,
        }),
      })
    }
  }
}
