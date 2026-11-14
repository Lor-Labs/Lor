import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type React from "react"
import { useId, useState } from "react"
import { TerminalTab } from "@/components/session/terminal-tab"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionTerminalSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { SessionPanelTabs } from "@/components/sidebar/right-panel/session-changes-panel"
import { apiClient } from "@/lib/api-client"

// The API's MAX_TERMINAL_TABS (packages/lor/src/dev-env/terminal.ts).
const MAX_TABS = 8

const terminalsKey = (sessionId: string) =>
  ["session-terminals", sessionId] as const

// The tab in front per session, so leaving the Terminal view (Changes,
// Browser) and coming back lands on the same shell.
const lastActive = new Map<string, number>()

// A person's terminal tabs (LOR-150): each number is its own shell in the
// sandbox, and the same number Lor sees in `lor-terminal list`. Tabs opened
// before (another device, an earlier visit) come from the API; the first one
// connects without waiting for that list.
function useTerminalTabs(sessionId: string) {
  const queryClient = useQueryClient()
  const [active, setActive] = useState(() => lastActive.get(sessionId) ?? 1)
  // Tabs shown here at least once: they stay connected behind the front one.
  const [visited, setVisited] = useState<number[]>([active])
  const [closing, setClosing] = useState<number[]>([])
  const { data } = useQuery({
    queryKey: terminalsKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].terminals.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Couldn't read the open terminals")
      return res.json()
    },
    // Each read runs a command in the sandbox, which wakes one in standby.
    refetchOnWindowFocus: false,
  })

  const known = data?.terminals.map((terminal) => terminal.tab) ?? []
  const tabs = [...new Set([...known, ...visited])]
    .filter((tab) => !closing.includes(tab))
    .sort((a, b) => a - b)

  const select = (tab: number) => {
    lastActive.set(sessionId, tab)
    setActive(tab)
    setVisited((prev) => (prev.includes(tab) ? prev : [...prev, tab]))
  }

  // The lowest free number; one still closing would attach the dying shell.
  let next: number | null = null
  for (let tab = 1; tab <= MAX_TABS && next === null; tab++) {
    if (!tabs.includes(tab) && !closing.includes(tab)) next = tab
  }

  const close = async (tab: number) => {
    setClosing((prev) => [...prev, tab])
    if (tab === active) {
      const rest = tabs.filter((other) => other !== tab)
      const neighbor = rest.find((other) => other > tab) ?? rest.at(-1)
      if (neighbor !== undefined) select(neighbor)
    }
    const res = await apiClient.v1.sessions[":sessionId"].terminals[":tab"]
      .$delete({ param: { sessionId, tab: String(tab) } })
      .catch(() => null)
    if (res?.ok) {
      setVisited((prev) => prev.filter((other) => other !== tab))
      // An in-flight list read from before the delete would bring the tab back.
      await queryClient.cancelQueries({ queryKey: terminalsKey(sessionId) })
      queryClient.setQueryData(terminalsKey(sessionId), (prev: typeof data) =>
        prev
          ? {
              terminals: prev.terminals.filter(
                (terminal) => terminal.tab !== tab
              ),
            }
          : prev
      )
      void queryClient.invalidateQueries({ queryKey: terminalsKey(sessionId) })
    } else {
      toast.error("Couldn't close that terminal")
    }
    setClosing((prev) => prev.filter((other) => other !== tab))
  }

  return {
    tabs,
    active,
    mounted: visited.filter((tab) => !closing.includes(tab)),
    next,
    select,
    close,
  }
}

// A code session's shells beside its chat (reference/dev-environment-runbook.md
// §4). A localhost link printed in one opens that port in the Browser tab.
export function SessionTerminalPanel({
  view,
}: {
  view: SessionTerminalSidebarView
}) {
  const { setView } = useRightSidebar()
  const { tabs, active, mounted, next, select, close } = useTerminalTabs(
    view.sessionId
  )
  const idPrefix = useId()
  const tabId = (tab: number) => `${idPrefix}-tab-${tab}`
  const panelId = (tab: number) => `${idPrefix}-panel-${tab}`

  // Roving focus: Left/Right moves to the neighboring tab and selects it.
  const onTabKeyDown = (event: React.KeyboardEvent, tab: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const index = tabs.indexOf(tab)
    const step = event.key === "ArrowRight" ? 1 : -1
    const target = tabs[(index + step + tabs.length) % tabs.length]
    if (target === undefined) return
    select(target)
    document.getElementById(tabId(target))?.focus()
  }
  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={<SessionPanelTabs view={view} />}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      <div
        role="tablist"
        aria-label="Terminals"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-border/70 border-b px-2 py-1 [scrollbar-width:none]!"
      >
        {tabs.map((tab) => (
          <div
            key={tab}
            className={cn(
              "group flex shrink-0 items-center rounded-md text-xs transition-colors",
              tab === active
                ? "bg-foreground/[0.06] font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <button
              type="button"
              role="tab"
              id={tabId(tab)}
              aria-selected={tab === active}
              aria-controls={mounted.includes(tab) ? panelId(tab) : undefined}
              tabIndex={tab === active ? 0 : -1}
              onClick={() => select(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
              className={cn(
                "cursor-pointer py-1 pl-2",
                tabs.length > 1 ? "pr-1" : "pr-2"
              )}
            >
              Terminal {tab}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                aria-label={`Close terminal ${tab}`}
                title="Close: ends this shell and what runs in it"
                onClick={() => void close(tab)}
                className={cn(
                  "mr-1 flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                  tab !== active && "opacity-0"
                )}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="size-3"
                  strokeWidth={2}
                />
              </button>
            )}
          </div>
        ))}
        {next !== null && (
          <button
            type="button"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => select(next)}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {mounted.map((tab) => (
          <div
            key={tab}
            role="tabpanel"
            id={panelId(tab)}
            aria-labelledby={tabId(tab)}
            className={cn(
              "absolute inset-0",
              tab !== active && "pointer-events-none invisible"
            )}
          >
            <TerminalTab
              sessionId={view.sessionId}
              tab={tab}
              active={tab === active}
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
        ))}
      </div>
    </div>
  )
}
