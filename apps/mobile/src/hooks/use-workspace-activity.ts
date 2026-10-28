import {
  type ChannelActivity,
  type RealtimeAgentSession,
  type SessionUncommittedUpdated,
  type SidebarSession,
  uncommittedLinesOf,
} from "@repo/realtime-types"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { AppState } from "react-native"
import { useSocket } from "@/context/socket-context"
import type { AppSocket } from "@/lib/socket"

// Bursty invalidations (run transition + plan update) collapse into one
// fetch. Fixed deadline: a constant stream cannot postpone it.
const COALESCE_MS = 100
const FETCH_TIMEOUT_MS = 10_000

export const workspaceActivityKey = (workspaceId: string) =>
  ["workspace-activity", workspaceId] as const

// Every change that moves a session row (archive, rename) runs under this
// key. Pushes wait while one is in flight, so a snapshot taken before the
// server saved it can't undo the optimistic row. Same key as web.
export const sidebarSessionMutationKey = ["sidebar-session"] as const

function fetchWorkspaceActivity(socket: AppSocket, workspaceId: string) {
  return new Promise<ChannelActivity[]>((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error("Socket disconnected"))
      return
    }
    const timer = setTimeout(
      () => reject(new Error("Workspace activity timed out")),
      FETCH_TIMEOUT_MS
    )
    socket.emit("workspace:activity", { workspaceId }, (result) => {
      clearTimeout(timer)
      if (result.ok) resolve(result.channels)
      else reject(new Error("Workspace activity failed"))
    })
  })
}

// Your session rows for the Channels tab, fetched over the socket.
// Push-driven, no polling: workspace:activity:updated and thread reads
// refetch; reconnects and coming back to the app refetch as a check for
// missed pushes. Mirrors web's use-workspace-activity.ts.
export function useWorkspaceActivity(workspaceId?: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: workspaceActivityKey(workspaceId ?? ""),
    queryFn: () => {
      if (!socket || !workspaceId) throw new Error("No workspace")
      return fetchWorkspaceActivity(socket, workspaceId)
    },
    enabled: Boolean(socket && workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!socket || !workspaceId) return
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (coalesceTimer) return
      coalesceTimer = setTimeout(() => {
        coalesceTimer = undefined
        if (
          queryClient.isMutating({ mutationKey: sidebarSessionMutationKey }) > 0
        ) {
          return
        }
        void queryClient.invalidateQueries({
          queryKey: workspaceActivityKey(workspaceId),
        })
      }, COALESCE_MS)
    }
    const onActivityUpdated = (payload: { workspaceId: string }) => {
      if (payload.workspaceId === workspaceId) refresh()
    }
    // A code session's +/− moves with every edit: patched, not refetched.
    // The count is saved before this push, so before the first snapshot
    // lands, or while one is in flight that may predate it, fetch again.
    const onUncommitted = (payload: SessionUncommittedUpdated) => {
      if (payload.workspaceId !== workspaceId) return
      patchUncommittedLines(queryClient, payload)
      const key = workspaceActivityKey(workspaceId)
      if (
        !queryClient.getQueryData(key) ||
        queryClient.isFetching({ queryKey: key }) > 0
      ) {
        refresh()
      }
    }
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh()
    })
    socket.on("connect", refresh)
    socket.on("workspace:activity:updated", onActivityUpdated)
    socket.on("session:uncommitted:updated", onUncommitted)
    // Reading a session (on any of the user's devices) clears its dot.
    socket.on("thread-read:updated", refresh)
    return () => {
      if (coalesceTimer) clearTimeout(coalesceTimer)
      appState.remove()
      socket.off("connect", refresh)
      socket.off("workspace:activity:updated", onActivityUpdated)
      socket.off("session:uncommitted:updated", onUncommitted)
      socket.off("thread-read:updated", refresh)
    }
  }, [socket, workspaceId, queryClient])

  return data
}

// Only a row the snapshot lists; never adds one. Mirrors web.
function patchUncommittedLines(
  queryClient: QueryClient,
  {
    workspaceId,
    channelId,
    sessionId,
    ...uncommitted
  }: SessionUncommittedUpdated
) {
  queryClient.setQueryData<ChannelActivity[]>(
    workspaceActivityKey(workspaceId),
    (channels) =>
      channels?.map((channel) =>
        channel.channelId === channelId
          ? {
              ...channel,
              sessions: channel.sessions.map((session) =>
                session.id === sessionId ? { ...session, uncommitted } : session
              ),
            }
          : channel
      )
  )
}

// A row for a session the snapshot doesn't list yet (a session start).
export function sidebarRowFor(session: RealtimeAgentSession): SidebarSession {
  return {
    id: session.id,
    threadRootId: session.threadRootId,
    title: session.title,
    titleEdited: session.titleEditedAt !== null,
    state: "idle",
    loop: session.loopId !== null,
    code: session.mode === "code",
    uncommitted: uncommittedLinesOf(session),
    lastActivityAt: session.lastActivityAt,
  }
}

export type SidebarSessionChange =
  | { hide: true }
  | { show: SidebarSession }
  | { title: string; titleEdited: boolean }

// Await before patchSidebarSession: an in-flight fetch carries an older
// snapshot, and a cancel that lands after the patch would revert it.
export function cancelSidebarFetch(
  queryClient: QueryClient,
  workspaceId: string
) {
  return queryClient.cancelQueries({
    queryKey: workspaceActivityKey(workspaceId),
  })
}

// Edits one session row in place. Synchronous, so a caller can patch the
// session page in the same tick and both type a new title out together.
export function patchSidebarSession(
  queryClient: QueryClient,
  target: { workspaceId: string; channelId: string; sessionId: string },
  change: SidebarSessionChange
) {
  queryClient.setQueryData<ChannelActivity[]>(
    workspaceActivityKey(target.workspaceId),
    (channels) => {
      if (!channels) return channels
      const withChannel = channels.some(
        (channel) => channel.channelId === target.channelId
      )
        ? channels
        : [...channels, { channelId: target.channelId, sessions: [] }]
      return withChannel.map((channel) => {
        if (channel.channelId !== target.channelId) return channel
        if ("hide" in change) {
          return {
            ...channel,
            sessions: channel.sessions.filter(
              (session) => session.id !== target.sessionId
            ),
          }
        }
        if ("show" in change) {
          return channel.sessions.some(
            (session) => session.id === target.sessionId
          )
            ? channel
            : { ...channel, sessions: [...channel.sessions, change.show] }
        }
        return {
          ...channel,
          sessions: channel.sessions.map((session) =>
            session.id === target.sessionId
              ? {
                  ...session,
                  title: change.title,
                  titleEdited: change.titleEdited,
                }
              : session
          ),
        }
      })
    }
  )
}
