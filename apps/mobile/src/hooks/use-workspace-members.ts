import type { PresenceUserUpdate } from "@repo/realtime-types"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { WorkspaceMember } from "@/lib/api-types"

export function useWorkspaceMembers(workspaceSlug: string) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const socket = useSocket()

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current
    if (!workspaceSlug) {
      setMembers([])
      setWorkspaceId(null)
      setError(null)
      setIsLoading(false)
      return
    }

    setError(null)
    setIsLoading(true)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load workspace members")
      const payload = await response.json()
      if (requestId !== requestRef.current) return
      setMembers(payload.members)
      setWorkspaceId(payload.workspaceId)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load workspace members"
      )
    } finally {
      if (requestId === requestRef.current) setIsLoading(false)
    }
  }, [workspaceSlug])

  useEffect(() => {
    setMembers([])
    setWorkspaceId(null)
    void reload()
    return () => {
      requestRef.current += 1
    }
  }, [reload])

  useEffect(() => {
    if (!socket || !workspaceId) return

    const applySnapshot = (onlineUserIds: string[]) => {
      const online = new Set(onlineUserIds)
      setMembers((current) =>
        current.map((member) => ({
          ...member,
          status:
            member.isBot || online.has(member.userId) ? "online" : "offline",
        }))
      )
    }
    const subscribe = () => {
      socket.emit("presence:subscribe", { workspaceId }, (result) => {
        if (result.ok && result.snapshot.workspaceId === workspaceId) {
          applySnapshot(result.snapshot.onlineUserIds)
        }
      })
    }
    const updatePresence = (payload: PresenceUserUpdate) => {
      if (payload.workspaceId !== workspaceId) return
      setMembers((current) =>
        current.map((member) =>
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
      socket.off("connect", subscribe)
      socket.off("presence:user:update", updatePresence)
    }
  }, [socket, workspaceId])

  return { members, isLoading, error, reload }
}
