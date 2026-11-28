import {
  Add01Icon,
  GitBranchIcon,
  SourceCodeIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar"
import { cn } from "@repo/ui/lib/utils"
import { DesktopSidebarTitlebar } from "@/components/desktop-titlebar"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import { me } from "../prototype-data"
import {
  type Agent,
  agentById,
  agents,
  type Channel,
  channels,
  type Work,
  type WorkState,
} from "./agents-data"
import {
  AgentAvatar,
  type AgentStatus,
  PlaceIcon,
  PRESS,
  StateIcon,
} from "./agents-parts"
import { useProto } from "./agents-store"

type Row = {
  key: string
  agentId: string
  title: string
  code: boolean
  state: WorkState
  active: boolean
  kids: Work[]
  open: () => void
}

const ORDER = { needs_you: 0, running: 1, done: 2 } as const

// Your work across every agent: the chats you are in and the code sessions
// you started yourself. Other people's chats stay on the agent's page.
function useMyWork(): Row[] {
  const { chats, works, view, stateOf, childrenOf, openChat, openWork } =
    useProto()
  const mine = chats
    .filter((chat) => chat.people.some((person) => person.id === me.id))
    .map((chat) => ({
      key: chat.id,
      agentId: chat.agentId,
      title: chat.title,
      code: false,
      state: stateOf(chat.id),
      active: view.kind === "chat" && view.chatId === chat.id,
      kids: childrenOf(chat.id).filter((work) => work.mode === "code"),
      open: () => openChat(chat.id),
    }))
  const code = Object.values(works)
    .filter((work) => !work.parentId && work.asker.id === me.id)
    .reverse()
    .map((work) => ({
      key: work.id,
      agentId: work.agentId,
      title: work.title,
      code: true,
      state: work.state,
      active: view.kind === "code" && view.workId === work.id,
      kids: [],
      open: () => openWork(work.id),
    }))
  return [...mine, ...code].sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

const ROW =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/[0.05]"
const ACTIVE = "bg-foreground/[0.07] hover:bg-foreground/[0.07]"

function WorkRow({ row, agentName }: { row: Row; agentName?: string }) {
  const { canvas, openWork } = useProto()
  return (
    <div>
      <button
        type="button"
        onClick={row.open}
        className={cn(ROW, PRESS, row.active && ACTIVE)}
      >
        <StateIcon state={row.state} />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">
          {row.title}
        </span>
        {row.code && (
          <HugeiconsIcon
            icon={GitBranchIcon}
            className="size-3.5 shrink-0 text-muted-foreground/70"
            strokeWidth={2}
          />
        )}
        {agentName && (
          <span className="shrink-0 text-[12px] text-muted-foreground">
            {agentName}
          </span>
        )}
      </button>
      {row.active && row.kids.length > 0 && (
        <div className="mt-0.5 ml-[17px] flex flex-col gap-0.5 border-l border-border/70 pl-2">
          {row.kids.map((work) => (
            <button
              key={work.id}
              type="button"
              onClick={() => openWork(work.id)}
              className={cn(
                ROW,
                PRESS,
                "gap-2 py-1",
                canvas?.kind === "work" && canvas.workId === work.id && ACTIVE
              )}
            >
              <StateIcon state={work.state} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                {work.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="px-2 pb-1 text-[12px] font-medium text-muted-foreground">
      {children}
    </h3>
  )
}

function useAgentStatus(agent: Agent, waiting: boolean): AgentStatus {
  const { works, configured } = useProto()
  if (!configured[agent.id]) return "off"
  if (waiting) return "needs_you"
  const running = Object.values(works).some(
    (work) => work.agentId === agent.id && work.state === "running"
  )
  return running ? "working" : "idle"
}

// An agent, with your chats with it underneath. A chat that waits on you
// sits under Needs you until it is handled.
function AgentGroup({
  agent,
  rows,
  waiting,
}: {
  agent: Agent
  rows: Row[]
  waiting: boolean
}) {
  const { view, configured, openAgent } = useProto()
  const status = useAgentStatus(agent, waiting)
  const active =
    (view.kind === "agent" || view.kind === "new") && view.agentId === agent.id
  return (
    <div>
      <button
        type="button"
        onClick={() => openAgent(agent.id)}
        className={cn(ROW, PRESS, "gap-2.5 py-1.5", active && ACTIVE)}
      >
        <AgentAvatar agent={agent} status={status} size={26} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {agent.name}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {configured[agent.id] ? agent.role : "Not set up"}
        </span>
      </button>
      {rows.length > 0 && (
        <div className="mt-0.5 ml-[20px] flex flex-col gap-0.5 border-l border-border/70 pl-1.5">
          {rows.map((row) => (
            <WorkRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelRow({ channel }: { channel: Channel }) {
  const { view, channelAgents, openChannel } = useProto()
  const agent = agentById(channelAgents[channel.id] ?? "")
  const active = view.kind === "channel" && view.channelId === channel.id
  return (
    <button
      type="button"
      onClick={() => openChannel(channel.id)}
      title={
        agent ? `${agent.name} is in #${channel.name}` : "No agent in here"
      }
      className={cn(ROW, PRESS, active && ACTIVE)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-[15px] text-muted-foreground">
        {channel.place === "lor" ? (
          "#"
        ) : (
          <PlaceIcon place={channel.place} className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">
        {channel.name}
      </span>
      {agent && <AgentAvatar agent={agent} size={18} />}
    </button>
  )
}

export function AgentsSidebar() {
  const { openNew, openNewCode } = useProto()
  const rows = useMyWork()
  const needs = rows.filter((row) => row.state === "needs_you")
  return (
    <Sidebar variant="inset">
      <DesktopSidebarTitlebar />
      <SidebarHeader className="gap-1 p-0 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-sidebar-accent">
              <WorkspaceAvatar
                name="Northstar"
                className="size-8 rounded-lg text-sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                Northstar
              </span>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 pb-2">
        <div className="mt-1 flex gap-1.5">
          <button
            type="button"
            onClick={() => openNew()}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-left text-[13.5px] font-medium hover:bg-foreground/[0.05]",
              PRESS
            )}
          >
            <HugeiconsIcon
              icon={Add01Icon}
              className="size-4 text-muted-foreground"
              strokeWidth={2}
            />
            New chat
          </button>
          <button
            type="button"
            onClick={() => openNewCode()}
            aria-label="New code session"
            title="New code session, straight in one repo"
            className={cn(
              "flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              PRESS
            )}
          >
            <HugeiconsIcon
              icon={SourceCodeIcon}
              className="size-4"
              strokeWidth={2}
            />
          </button>
        </div>

        {needs.length > 0 && (
          <section className="pt-4">
            <Heading>Needs you</Heading>
            <div className="flex flex-col gap-0.5">
              {needs.map((row) => (
                <WorkRow
                  key={row.key}
                  row={row}
                  agentName={agentById(row.agentId)?.name}
                />
              ))}
            </div>
          </section>
        )}

        <section className="pt-4">
          <Heading>Agents</Heading>
          <div className="flex flex-col gap-1">
            {agents.map((agent) => (
              <AgentGroup
                key={agent.id}
                agent={agent}
                rows={rows.filter(
                  (row) => row.agentId === agent.id && row.state !== "needs_you"
                )}
                waiting={needs.some((row) => row.agentId === agent.id)}
              />
            ))}
          </div>
        </section>

        <section className="pt-4">
          <Heading>Channels</Heading>
          <div className="flex flex-col gap-0.5">
            {channels.map((channel) => (
              <ChannelRow key={channel.id} channel={channel} />
            ))}
          </div>
        </section>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3">
        <p className="text-[11px] text-muted-foreground/70">
          Prototype · made-up data
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
