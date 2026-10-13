import type {
  ChannelReadState,
  NotificationBootstrap,
  UnreadNotification,
} from "@repo/realtime-types"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"

type UnreadState = {
  unreadCount: number
  mentionCount: number
  lastReadMessageId?: string | null
  lastReadAt?: string
  // undefined = unknown; null = no unread feed message.
  firstUnreadMessageId?: string | null
}

type UnreadSnapshot = {
  stateMap: Map<string, UnreadState>
  initialized: boolean
}

type UnreadContextValue = UnreadSnapshot & {
  markChannelRead: (channelId: string, lastReadMessageId?: string) => void
}

const UnreadContext = createContext<UnreadContextValue>({
  stateMap: new Map(),
  initialized: false,
  markChannelRead: () => {},
})

export function useUnread() {
  const { stateMap, initialized, markChannelRead } = useContext(UnreadContext)

  const getUnreadCount = useCallback(
    (channelId: string) => stateMap.get(channelId)?.unreadCount ?? 0,
    [stateMap]
  )
  const getMentionCount = useCallback(
    (channelId: string) => stateMap.get(channelId)?.mentionCount ?? 0,
    [stateMap]
  )
  const getFirstUnreadMessageId = useCallback(
    (channelId: string) => {
      const state = stateMap.get(channelId)
      return state ? state.firstUnreadMessageId : initialized ? null : undefined
    },
    [stateMap, initialized]
  )

  return {
    getUnreadCount,
    getMentionCount,
    getFirstUnreadMessageId,
    markChannelRead,
  }
}

function emptyState(initialized: boolean): UnreadState {
  return {
    unreadCount: 0,
    mentionCount: 0,
    firstUnreadMessageId: initialized ? null : undefined,
  }
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const socket = useSocket()
  const [snapshot, setSnapshot] = useState<UnreadSnapshot>(() => ({
    stateMap: new Map(),
    initialized: false,
  }))

  useEffect(() => {
    if (!socket) return

    const onBootstrap = (payload: NotificationBootstrap) => {
      const stateMap = new Map<string, UnreadState>()
      for (const rs of payload.readStates) {
        stateMap.set(rs.channelId, {
          unreadCount: rs.unreadCount,
          mentionCount: rs.mentionCount,
          lastReadMessageId: rs.lastReadMessageId,
          firstUnreadMessageId: rs.firstUnreadMessageId,
        })
      }
      setSnapshot({ stateMap, initialized: true })
    }

    const onUnread = (payload: UnreadNotification) => {
      setSnapshot((prev) => {
        const stateMap = new Map(prev.stateMap)
        const current =
          stateMap.get(payload.channelId) ?? emptyState(prev.initialized)
        const isFeedMessage =
          !payload.threadRootId && payload.messageType !== "event"
        stateMap.set(payload.channelId, {
          ...current,
          unreadCount: current.unreadCount + payload.unreadCountDelta,
          // Keep the earliest boundary while away, even after more messages arrive.
          firstUnreadMessageId:
            current.firstUnreadMessageId === null && isFeedMessage
              ? payload.messageId
              : current.firstUnreadMessageId,
        })
        return { ...prev, stateMap }
      })
    }

    const onMention = (payload: {
      channelId: string
      sessionId?: string | null
    }) => {
      // A session mention alerts on the session's sidebar row instead.
      if (payload.sessionId) return
      setSnapshot((prev) => {
        const stateMap = new Map(prev.stateMap)
        const current =
          stateMap.get(payload.channelId) ?? emptyState(prev.initialized)
        stateMap.set(payload.channelId, {
          ...current,
          mentionCount: current.mentionCount + 1,
        })
        return { ...prev, stateMap }
      })
    }

    const onReadState = (payload: ChannelReadState) => {
      setSnapshot((prev) => {
        const current = prev.stateMap.get(payload.channelId)
        if (current?.lastReadAt && current.lastReadAt > payload.lastReadAt)
          return prev
        const stateMap = new Map(prev.stateMap)
        stateMap.set(payload.channelId, {
          unreadCount: payload.unreadCount,
          mentionCount: payload.mentionCount,
          lastReadMessageId: payload.lastReadMessageId,
          lastReadAt: payload.lastReadAt,
          firstUnreadMessageId:
            payload.unreadCount === 0 ? null : payload.firstUnreadMessageId,
        })
        return { ...prev, stateMap }
      })
    }

    const onDisconnect = () => {
      setSnapshot((prev) => ({
        initialized: false,
        stateMap: new Map(
          [...prev.stateMap].map(([channelId, state]) => [
            channelId,
            { ...state, firstUnreadMessageId: undefined },
          ])
        ),
      }))
    }

    socket.on("notification:bootstrap", onBootstrap)
    socket.on("notification:unread", onUnread)
    socket.on("notification:mention", onMention)
    socket.on("channel:read-state", onReadState)
    socket.on("disconnect", onDisconnect)
    return () => {
      socket.off("notification:bootstrap", onBootstrap)
      socket.off("notification:unread", onUnread)
      socket.off("notification:mention", onMention)
      socket.off("channel:read-state", onReadState)
      socket.off("disconnect", onDisconnect)
    }
  }, [socket])

  const markChannelRead = useCallback(
    (channelId: string, lastReadMessageId?: string) => {
      if (!socket?.connected) return

      let previous: UnreadState | undefined
      setSnapshot((prev) => {
        const stateMap = new Map(prev.stateMap)
        previous = stateMap.get(channelId)
        // Retain the known read baseline for the next realtime notification.
        stateMap.set(channelId, {
          ...previous,
          unreadCount: 0,
          mentionCount: 0,
          firstUnreadMessageId: lastReadMessageId ? undefined : null,
        })
        return { ...prev, stateMap }
      })

      socket.emit(
        "channel:mark-read",
        { channelId, lastReadMessageId },
        (res) => {
          if (res.ok || !previous) return
          const restore = previous
          setSnapshot((prev) => {
            const current = prev.stateMap.get(channelId)
            // A later read from another tab/device supersedes this failed attempt.
            if (current?.lastReadAt !== restore.lastReadAt) return prev
            const stateMap = new Map(prev.stateMap)
            stateMap.set(channelId, {
              ...restore,
              unreadCount: restore.unreadCount + (current?.unreadCount ?? 0),
              mentionCount: restore.mentionCount + (current?.mentionCount ?? 0),
              firstUnreadMessageId:
                restore.firstUnreadMessageId === null
                  ? current?.firstUnreadMessageId
                  : restore.firstUnreadMessageId,
            })
            return { ...prev, stateMap }
          })
        }
      )
    },
    [socket]
  )

  return (
    <UnreadContext.Provider value={{ ...snapshot, markChannelRead }}>
      {children}
    </UnreadContext.Provider>
  )
}
