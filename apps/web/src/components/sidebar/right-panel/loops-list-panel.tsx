import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LoopRow, sortLoops } from "@/components/loops/loop-row"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { LoopsListSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { useChannelLoops } from "@/hooks/use-channel-loops"

// Full channel loops list — opened from the overview panel's Loops section
// ("Show more"). Rows open the loop detail panel; its back button returns
// here.
export function LoopsListPanel({ view }: { view: LoopsListSidebarView }) {
  const { setView } = useRightSidebar()
  const { data, isPending } = useChannelLoops(view.channelId)
  const loops = sortLoops(data ?? [])

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title="Loops"
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isPending && (
          <div className="p-4 text-center text-muted-foreground text-sm">
            Loading...
          </div>
        )}
        {data && loops.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <HugeiconsIcon
              icon={Infinity01Icon}
              size={32}
              className="text-muted-foreground/40"
            />
            <p className="text-muted-foreground text-sm">
              No loops in this channel yet
            </p>
            <p className="text-muted-foreground/70 text-xs">
              Ask Merlin to do something on a schedule to set one up.
            </p>
          </div>
        )}
        <div className="space-y-0.5">
          {loops.map((loop) => (
            <LoopRow
              key={loop.id}
              loop={loop}
              onOpen={() =>
                setView({
                  type: "loop",
                  workspaceSlug: view.workspaceSlug,
                  channelId: view.channelId,
                  loopId: loop.id,
                })
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
