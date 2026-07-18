import type {
  ChannelReadState,
  MentionNotification,
  NotificationBootstrap,
  UnreadNotification,
} from "@repo/realtime-types"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"

type UnreadState = {
  unreadCount: number
  mentionCount: number
}

type UnreadContextValue = {
  stateMap: Map<string, UnreadState>
  markChannelRead: (channelId: string, lastReadMessageId?: string) => void
}

const UnreadContext = createContext<UnreadContextValue>({
  stateMap: new Map(),
  markChannelRead: () => {},
})

export function useUnread() {
  const { stateMap, markChannelRead } = useContext(UnreadContext)

  const getUnreadCount = useCallback(
    (channelId: string) => stateMap.get(channelId)?.unreadCount ?? 0,
    [stateMap]
  )

  const getMentionCount = useCallback(
    (channelId: string) => stateMap.get(channelId)?.mentionCount ?? 0,
    [stateMap]
  )

  const totalMentionCount = useMemo(() => {
    let total = 0
    for (const state of stateMap.values()) total += state.mentionCount
    return total
  }, [stateMap])

  return { getUnreadCount, getMentionCount, markChannelRead, totalMentionCount }
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const socket = useSocket()
  const [stateMap, setStateMap] = useState<Map<string, UnreadState>>(
    () => new Map()
  )

  useEffect(() => {
    if (!socket) return

    const onBootstrap = (payload: NotificationBootstrap) => {
      const newMap = new Map<string, UnreadState>()
      for (const rs of payload.readStates) {
        newMap.set(rs.channelId, {
          unreadCount: rs.unreadCount,
          mentionCount: rs.mentionCount,
        })
      }
      setStateMap(newMap)
    }

    const onUnread = (payload: UnreadNotification) => {
      setStateMap((prev) => {
        const next = new Map(prev)
        const current = next.get(payload.channelId) ?? {
          unreadCount: 0,
          mentionCount: 0,
        }
        next.set(payload.channelId, {
          ...current,
          unreadCount: current.unreadCount + payload.unreadCountDelta,
        })
        return next
      })
    }

    const onMention = (payload: MentionNotification) => {
      setStateMap((prev) => {
        const next = new Map(prev)
        const current = next.get(payload.channelId) ?? {
          unreadCount: 0,
          mentionCount: 0,
        }
        next.set(payload.channelId, {
          ...current,
          mentionCount: current.mentionCount + 1,
        })
        return next
      })
    }

    const onReadState = (payload: ChannelReadState) => {
      setStateMap((prev) => {
        const next = new Map(prev)
        if (payload.unreadCount === 0 && payload.mentionCount === 0) {
          next.delete(payload.channelId)
        } else {
          next.set(payload.channelId, {
            unreadCount: payload.unreadCount,
            mentionCount: payload.mentionCount,
          })
        }
        return next
      })
    }

    socket.on("notification:bootstrap", onBootstrap)
    socket.on("notification:unread", onUnread)
    socket.on("notification:mention", onMention)
    socket.on("channel:read-state", onReadState)

    return () => {
      socket.off("notification:bootstrap", onBootstrap)
      socket.off("notification:unread", onUnread)
      socket.off("notification:mention", onMention)
      socket.off("channel:read-state", onReadState)
    }
  }, [socket])

  const markChannelRead = useCallback(
    (channelId: string, lastReadMessageId?: string) => {
      if (!socket) return

      let snapshot: UnreadState | undefined
      setStateMap((prev) => {
        const next = new Map(prev)
        snapshot = prev.get(channelId)
        next.delete(channelId)
        return next
      })

      socket.emit(
        "channel:mark-read",
        { channelId, lastReadMessageId },
        (res) => {
          if (!res.ok && snapshot) {
            const restore = snapshot
            setStateMap((prev) => {
              const next = new Map(prev)
              next.set(channelId, restore)
              return next
            })
          }
        }
      )
    },
    [socket]
  )

  return (
    <UnreadContext.Provider value={{ stateMap, markChannelRead }}>
      {children}
    </UnreadContext.Provider>
  )
}
