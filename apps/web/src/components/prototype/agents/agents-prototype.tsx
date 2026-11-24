import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar"
import { AnimatePresence, motion } from "motion/react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { AgentCanvas, WorkCanvas } from "./agent-canvas"
import { ChatView } from "./agent-chat"
import { AgentPage, NewChat, NewCodeSession } from "./agent-page"
import { agentById, channelById } from "./agents-data"
import { AgentsSidebar } from "./agents-sidebar"
import { AgentsStore, useProto } from "./agents-store"
import { ChannelView } from "./channel-view"

// Dev-only prototype of reference/agents-and-chats.md: agents are
// separate from channels and added to them, a chat is one piece of work with
// an agent, and the agent starts code sessions under a chat.
export function AgentsPrototype() {
  return (
    <AgentsStore>
      <Layout />
    </AgentsStore>
  )
}

const DRAWER = [0.32, 0.72, 0, 1] as const

function Main() {
  const { view, chats, works } = useProto()
  if (view.kind === "chat") {
    const chat = chats.find((item) => item.id === view.chatId)
    return chat ? <ChatView key={chat.id} chat={chat} /> : null
  }
  if (view.kind === "code") {
    const work = works[view.workId]
    return work ? (
      <div className="h-full min-w-0 flex-1">
        <WorkCanvas key={work.id} work={work} main />
      </div>
    ) : null
  }
  if (view.kind === "channel") {
    const channel = channelById(view.channelId)
    return channel ? <ChannelView key={channel.id} channel={channel} /> : null
  }
  if (view.kind === "new")
    return <NewChat key={view.agentId} agentId={view.agentId} />
  if (view.kind === "newCode")
    return <NewCodeSession key={view.agentId} agentId={view.agentId} />
  const agent = agentById(view.agentId)
  return agent ? (
    <AgentPage key={agent.id} agent={agent} tab={view.tab} />
  ) : null
}

function Layout() {
  const { canvas, closeCanvas } = useProto()
  const frame = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(1200)

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrameWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCanvas()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeCanvas])

  // The panel keeps its final width while it slides, so only the chat reflows.
  const canvasWidth = Math.round(
    Math.min(Math.max(frameWidth * 0.54, 440), 840, frameWidth)
  )

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-sidebar text-foreground">
      <SidebarProvider
        className="h-full min-h-0 overflow-hidden"
        style={{ "--sidebar-width": "280px" } as CSSProperties}
      >
        <AgentsSidebar />
        <SidebarInset className="min-w-0 md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-none">
          <div
            ref={frame}
            className="flex h-full min-h-0 min-w-0 overflow-hidden md:rounded-[inherit]"
          >
            <Main />
            <AnimatePresence initial={false}>
              {canvas && (
                <motion.aside
                  key="canvas"
                  initial={{ width: 0 }}
                  animate={{ width: canvasWidth }}
                  exit={{ width: 0 }}
                  transition={{ duration: 0.32, ease: DRAWER }}
                  className="shrink-0 overflow-hidden border-l border-border/60"
                >
                  <div style={{ width: canvasWidth }} className="h-full">
                    <AgentCanvas canvas={canvas} />
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
