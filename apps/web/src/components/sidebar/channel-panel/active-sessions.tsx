import type { SidebarSession, SidebarSessionState } from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import {
  SessionStateIndicator,
  useAllChannelActivity,
} from "@/components/sidebar/channel-panel/channel-activity"
import {
  sidebarRow,
  sidebarRowHover,
  sidebarRowSelected,
  sidebarSectionLabel,
} from "@/components/sidebar/sidebar-menu-styles"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import { prefetchSession } from "@/hooks/use-agent-session"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

// Cross-channel "Sessions" list below the channels: your subscribed sessions
// that need you, are running or have unread replies, across every channel.
// Channels keep their own session rows; this is the attention view.

const STATE_ORDER: Record<SidebarSessionState, number> = {
  needs_you: 0,
  running: 1,
  unread: 2,
  idle: 3,
}

const STATE_TEXT: Record<Exclude<SidebarSessionState, "idle">, string> = {
  needs_you: "Needs you",
  running: "Lor is working",
  unread: "New reply",
}

type ActiveSession = { session: SidebarSession; channelId: string }

export function ActiveSessions() {
  const channels = useAllChannelActivity()
  const { workspaceSlug } = useParams({ strict: false })
  const { data: channelData } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug ?? "")
  )
  const channelNames = useMemo(
    () =>
      new Map<string, string | null>(
        channelData
          ? openTextChannels(channelData).map((channel) => [
              channel.id,
              channel.name,
            ])
          : []
      ),
    [channelData]
  )

  const active = useMemo(
    () =>
      [...channels.values()]
        .flatMap((channel) =>
          channel.sessions
            .filter((session) => session.state !== "idle")
            .map((session) => ({ session, channelId: channel.channelId }))
        )
        .sort(
          (a, b) =>
            STATE_ORDER[a.session.state] - STATE_ORDER[b.session.state] ||
            b.session.lastActivityAt.localeCompare(a.session.lastActivityAt)
        ),
    [channels]
  )
  const needsYou = active.filter(
    ({ session }) => session.state === "needs_you"
  ).length

  return (
    <section aria-label="Sessions" className="mt-3 px-2">
      <div className="flex items-center gap-2 px-1 py-1">
        <span className={sidebarSectionLabel}>Sessions</span>
        {needsYou > 0 && (
          <span className="rounded-full bg-warning/12 px-1.5 text-[11px] font-medium text-warning-foreground">
            {needsYou} needs you
          </span>
        )}
      </div>
      {active.length === 0 ? (
        <p className="px-1 pb-1 text-[12px] leading-snug text-muted-foreground">
          Tasks you hand to Lor show up here while they run. Type @Lor in a
          channel to start one.
        </p>
      ) : (
        active.map((item) => (
          <ActiveSessionRow
            key={item.session.id}
            item={item}
            channelName={channelNames.get(item.channelId) ?? null}
          />
        ))
      )}
    </section>
  )
}

function ActiveSessionRow({
  item: { session, channelId },
  channelName,
}: {
  item: ActiveSession
  channelName: string | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { workspaceSlug, sessionId } = useParams({ strict: false })
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar()
  const active = sessionId === session.id
  const state = active && session.state === "unread" ? "idle" : session.state
  const prefetch = () => {
    if (!workspaceSlug) return
    prefetchSession(queryClient, workspaceSlug, {
      id: session.id,
      channelId,
      threadRootId: session.threadRootId,
    })
  }
  const detail = state === "idle" ? null : STATE_TEXT[state]

  return (
    <button
      type="button"
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onClick={() => {
        prefetch()
        if (!workspaceSlug) return
        void navigate({
          to: "/$workspaceSlug/session/$sessionId",
          params: { workspaceSlug, sessionId: session.id },
        })
        setMobileSidebarOpen(false)
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        sidebarRow,
        "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-[5px] text-left",
        active ? sidebarRowSelected : sidebarRowHover
      )}
    >
      <span className="mt-[3px] flex w-3.5 shrink-0 justify-center">
        <SessionStateIndicator state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">
          {session.title}
        </span>
        <span
          className={cn(
            "block truncate text-[11px]",
            state === "needs_you"
              ? "text-warning-foreground"
              : "text-muted-foreground"
          )}
        >
          {[detail, channelName && `#${channelName}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  )
}
