import { TerminalTab } from "@/components/session/terminal-tab"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionTerminalSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { SessionPanelTabs } from "@/components/sidebar/right-panel/session-changes-panel"

// A code session's shell beside its chat (reference/dev-environment-runbook.md
// §4). A localhost link printed in it opens that port in the Browser tab.
export function SessionTerminalPanel({
  view,
}: {
  view: SessionTerminalSidebarView
}) {
  const { setView } = useRightSidebar()
  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={<SessionPanelTabs view={view} />}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      <div className="min-h-0 flex-1">
        <TerminalTab
          sessionId={view.sessionId}
          onOpenPort={(port, path) =>
            setView({
              type: "session-browser",
              workspaceSlug: view.workspaceSlug,
              channelId: view.channelId,
              sessionId: view.sessionId,
              threadRootId: view.threadRootId,
              open: { id: crypto.randomUUID(), port, path },
            })
          }
        />
      </div>
    </div>
  )
}
