import { Tabs, TabsList, TabsPanel, TabsTab } from "@repo/ui/components/tabs"
import { useState } from "react"
import { ChannelList } from "@/components/sidebar/channel-panel/channel-list"
import {
  NeedsYouList,
  useNeedsYou,
} from "@/components/sidebar/channel-panel/needs-you-list"

type SidebarTab = "needs" | "channels"

const TAB_KEY = "lor:sidebar-tab"

function readTab(): SidebarTab {
  try {
    return localStorage.getItem(TAB_KEY) === "needs" ? "needs" : "channels"
  } catch {
    return "channels"
  }
}

// The sidebar's two tabs (reference/always-on-agents.md, decision 24): what
// needs you, with the sessions running, and the channels. The count on Needs
// you is what waits on the person; running sessions don't add to it.
export function SidebarTabs() {
  const [tab, setTab] = useState<SidebarTab>(readTab)
  const { count } = useNeedsYou()
  const change = (next: SidebarTab) => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {}
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        change(value === "needs" ? "needs" : "channels")
      }
      className="gap-1"
    >
      <TabsList className="mx-2 w-[calc(100%-1rem)]">
        <TabsTab value="needs" className="text-[13px]">
          Needs you
          {count > 0 && (
            <span className="rounded-full bg-warning/20 px-1.5 font-semibold text-[11px] text-warning-foreground tabular-nums">
              {count}
            </span>
          )}
        </TabsTab>
        <TabsTab value="channels" className="text-[13px]">
          Channels
        </TabsTab>
      </TabsList>
      <TabsPanel value="needs">
        <NeedsYouList />
      </TabsPanel>
      <TabsPanel value="channels">
        <ChannelList />
      </TabsPanel>
    </Tabs>
  )
}
