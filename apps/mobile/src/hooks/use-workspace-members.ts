import type { PresenceUserUpdate } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { WorkspaceMember, WorkspaceMemberList } from "@/lib/api-types"

export function useWorkspaceMembers(workspaceSlug: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const enabled = Boolean(workspaceSlug)
  const query = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    enabled,
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load workspace members")
      return response.json()
    },
  })
  const { refetch } = query
  const workspaceId = query.data?.workspaceId ?? null

  useEffect(() => {
    if (!socket || !workspaceId) return
    let disposed = false

    const patchMembers = (
      updater: (members: WorkspaceMember[]) => WorkspaceMember[]
    ) => {
      queryClient.setQueryData<WorkspaceMemberList>(
        ["workspace-members", workspaceSlug],
        (current) =>
          current ? { ...current, members: updater(current.members) } : current
      )
    }
    const applySnapshot = (onlineUserIds: string[]) => {
      const online = new Set(onlineUserIds)
      patchMembers((members) =>
        members.map((member) => ({
          ...member,
          status:
            member.isBot || online.has(member.userId) ? "online" : "offline",
        }))
      )
    }
    const subscribe = () => {
      socket.emit("presence:subscribe", { workspaceId }, (result) => {
        if (disposed) return
        if (result.ok && result.snapshot.workspaceId === workspaceId) {
          applySnapshot(result.snapshot.onlineUserIds)
        }
      })
    }
    const updatePresence = (payload: PresenceUserUpdate) => {
      if (payload.workspaceId !== workspaceId) return
      patchMembers((members) =>
        members.map((member) =>
          member.userId === payload.userId
            ? {
                ...member,
                status: payload.status === "online" ? "online" : "offline",
              }
            : member
        )
      )
    }

    if (socket.connected) subscribe()
    socket.on("connect", subscribe)
    socket.on("presence:user:update", updatePresence)
    return () => {
      disposed = true
      socket.off("connect", subscribe)
      socket.off("presence:user:update", updatePresence)
    }
  }, [socket, workspaceId, workspaceSlug, queryClient])

  const reload = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    members: query.data?.members ?? [],
    isLoading: enabled && query.isPending,
    error: query.error?.message ?? null,
    reload,
  }
}
