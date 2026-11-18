import {
  Add01Icon,
  GitBranchIcon,
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
  type Work,
  type WorkState,
} from "./agents-data"
import {
  AgentAvatar,
  type AgentStatus,
  PRESS,
  RoomIcon,
  Segmented,
  StateIcon,
} from "./agents-parts"
import { useProto } from "./agents-store"

type Row = {
  key: string
  title: string
  agentName: string
  code: boolean
  state: WorkState
  active: boolean
  kids: Work[]
  open: () => void
}

// Your work across every agent: the threads you are in and the code
// threads you started yourself.
function useMyWork(): Row[] {
  const { threads, works, view, stateOf, childrenOf, openThread, openWork } =
    useProto()
  const chats = threads
    .filter((thread) => thread.people.some((person) => person.id === me.id))
    .map((thread) => ({
      key: thread.id,
      title: thread.title,
      agentName: agentById(thread.agentId)?.name ?? "",
      code: false,
      state: stateOf(thread.id),
      active: view.kind === "thread" && view.threadId === thread.id,
      kids: childrenOf(thread.id).filter((work) => work.mode === "code"),
      open: () => openThread(thread.id),
    }))
  const code = Object.values(works)
    .filter((work) => !work.parentId && work.owner.id === me.id)
    .reverse()
    .map((work) => ({
      key: work.id,
      title: work.title,
      agentName: agentById(work.agentId)?.name ?? "",
      code: true,
      state: work.state,
      active: view.kind === "code" && view.workId === work.id,
      kids: [],
      open: () => openWork(work.id),
    }))
  return [...code, ...chats]
}

const GROUPS: { state: WorkState; label: string }[] = [
  { state: "needs_you", label: "Needs you" },
  { state: "running", label: "Running" },
  { state: "done", label: "Recent" },
]

function MyWorkRow({ row }: { row: Row }) {
  const { canvas, openWork } = useProto()
  return (
    <div>
      <button
        type="button"
        onClick={row.open}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/[0.05]",
          PRESS,
          row.active && "bg-foreground/[0.07] hover:bg-foreground/[0.07]"
        )}
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
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {row.agentName}
        </span>
      </button>
      {row.active && row.kids.length > 0 && (
        <div className="mt-0.5 ml-[17px] flex flex-col gap-0.5 border-l border-border/70 pl-2">
          {row.kids.map((work) => (
            <button
              key={work.id}
              type="button"
              onClick={() => openWork(work.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-foreground/[0.05]",
                PRESS,
                canvas?.kind === "work" &&
                  canvas.workId === work.id &&
                  "bg-foreground/[0.07] hover:bg-foreground/[0.07]"
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

function MyWorkList({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col gap-4 pt-3">
      {GROUPS.map((group) => {
        const items = rows.filter((row) => row.state === group.state)
        if (items.length === 0) return null
        return (
          <section key={group.state}>
            <h3 className="px-2 pb-1 text-[12px] font-medium text-muted-foreground">
              {group.label}
            </h3>
            <div className="flex flex-col gap-0.5">
              {items.map((row) => (
                <MyWorkRow key={row.key} row={row} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function useRosterRow(agent: Agent): { status: AgentStatus; line: string } {
  const { works, threads, configured, stateOf } = useProto()
  if (!configured[agent.id]) return { status: "off", line: "Not set up yet" }
  const needs = threads.find(
    (thread) =>
      thread.agentId === agent.id &&
      thread.people.some((person) => person.id === me.id) &&
      stateOf(thread.id) === "needs_you"
  )
  if (needs) return { status: "needs_you", line: `Needs you: ${needs.title}` }
  const running = Object.values(works).filter(
    (work) => work.agentId === agent.id && work.state === "running"
  ).length
  if (running > 0) {
    return {
      status: "working",
      line: `${running} ${running === 1 ? "thread" : "work"} running`,
    }
  }
  return { status: "idle", line: agent.job }
}

function RosterRow({ agent }: { agent: Agent }) {
  const { view, rooms, openAgent } = useProto()
  const { status, line } = useRosterRow(agent)
  const room = rooms[agent.id]
  const active =
    (view.kind === "agent" || view.kind === "new") && view.agentId === agent.id
  return (
    <button
      type="button"
      onClick={() => openAgent(agent.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-foreground/[0.05]",
        PRESS,
        active && "bg-foreground/[0.07] hover:bg-foreground/[0.07]"
      )}
    >
      <AgentAvatar agent={agent} status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-5">
          {agent.name}
        </span>
        <span
          className={cn(
            "block truncate text-[12.5px] leading-4",
            status === "needs_you"
              ? "text-foreground/80"
              : "text-muted-foreground"
          )}
        >
          {line}
        </span>
      </span>
      {room && <RoomIcon room={room} className="text-muted-foreground/70" />}
    </button>
  )
}

export function AgentsSidebar() {
  const { sidebarTab, setSidebarTab, openNew } = useProto()
  const rows = useMyWork()
  const needs = rows.filter((row) => row.state === "needs_you").length
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
        <button
          type="button"
          onClick={() => openNew()}
          className={cn(
            "mt-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-left text-[13.5px] font-medium hover:bg-foreground/[0.05]",
            PRESS
          )}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            className="size-4 text-muted-foreground"
            strokeWidth={2}
          />
          New session
        </button>

        <Segmented
          id="sidebar-tab"
          className="mt-3"
          value={sidebarTab}
          onChange={setSidebarTab}
          items={[
            {
              id: "work",
              label: (
                <>
                  Work
                  {needs > 0 && (
                    <span className="rounded-full bg-warning/20 px-1.5 text-[11px] font-semibold text-warning-foreground tabular-nums">
                      {needs}
                    </span>
                  )}
                </>
              ),
            },
            { id: "agents", label: "Agents" },
          ]}
        />

        {sidebarTab === "work" ? (
          <MyWorkList rows={rows} />
        ) : (
          <div className="flex flex-col gap-0.5 pt-3">
            {agents.map((agent) => (
              <RosterRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="px-4 py-3">
        <p className="text-[11px] text-muted-foreground/70">
          Prototype · made-up data
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
