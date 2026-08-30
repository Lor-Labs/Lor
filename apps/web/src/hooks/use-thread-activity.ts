import type {
  RealtimeMessageThreadUpdated,
  ThreadReadUpdated,
} from "@repo/realtime-types"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Message } from "@/lib/api-types"
import type { AppSocket } from "@/lib/socket"

export interface ThreadActivityReplyPreview {
  content: string | null
  authorName: string
  hasAttachments: boolean
  mentions: Message["mentions"]
}

export interface ThreadActivity {
  threadRootId: string
  replyCount: number
  /** Replies the caller hasn't read — the dock badge. */
  newReplyCount: number
  lastReplyAt: string
  participants: RealtimeMessageThreadUpdated["participants"]
  /** Preview of the newest reply — the activity the card surfaces. */
  lastReply?: ThreadActivityReplyPreview | null
}

interface UseThreadActivityOptions {
  socket: AppSocket | null
  channelId: string
  /** Server-seeded activity for this channel (unread thread replies). */
  seed?: ThreadActivity[]
  /**
   * Thread currently open in the right panel. We never bump it (you're already
   * looking at it) and keep it cleared even after the panel closes.
   */
  suppressThreadRootId?: string | null
}

// Bounded set — the dock collapses to a few blobs plus an overflow count, so
// this caps the expanded card list, not the ambient footprint.
const MAX_ACTIVITIES = 8

/**
 * Surfaces fresh thread replies in the floating dock so activity buried up in
 * history isn't missed.
 *
 * `activities` is *derived* from two sources rather than a stateful merge:
 *   - `seed`: the server's authoritative unread-thread set on channel open.
 *   - live `message:thread:updated` events that arrive during the visit.
 * Deriving (not merging into state) means an empty/refetched seed correctly
 * clears stale cards instead of resurrecting them. Dismissed/opened threads
 * are filtered out until a genuinely newer reply revives them.
 *
 * Unread counts: the seed carries the server's `newReplyCount`; live events
 * only say "the thread changed", so we count +1 per event that advances
 * `lastReplyAt` (edits/deletes don't). Reading a thread (here or on another
 * device) zeroes its baseline, so a revived thread restarts at 1.
 */
export function useThreadActivity({
  socket,
  channelId,
  seed,
  suppressThreadRootId,
}: UseThreadActivityOptions) {
  const [live, setLive] = useState<ThreadActivity[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  // Threads read at least once this visit — their seed baseline is consumed.
  const [readBaselines, setReadBaselines] = useState<Set<string>>(
    () => new Set()
  )
  const seedRef = useRef(seed)
  seedRef.current = seed

  // All sources are channel-scoped — drop them when the channel changes.
  useEffect(() => {
    setLive([])
    setDismissed(new Set())
    setReadBaselines(new Set())
  }, [channelId])

  const dismiss = useCallback((threadRootId: string) => {
    setDismissed((prev) => {
      if (prev.has(threadRootId)) return prev
      const next = new Set(prev)
      next.add(threadRootId)
      return next
    })
    setReadBaselines((prev) => {
      if (prev.has(threadRootId)) return prev
      const next = new Set(prev)
      next.add(threadRootId)
      return next
    })
    // Reading consumes the live increments too — a later revival counts from 1.
    setLive((prev) =>
      prev.map((a) =>
        a.threadRootId === threadRootId && a.newReplyCount !== 0
          ? { ...a, newReplyCount: 0 }
          : a
      )
    )
  }, [])

  // Opening a thread counts as reading it — keep it gone even after the panel
  // closes (a new reply will still re-surface it via the live handler below).
  useEffect(() => {
    if (suppressThreadRootId) dismiss(suppressThreadRootId)
  }, [suppressThreadRootId, dismiss])

  useEffect(() => {
    if (!socket) return

    const handleThreadUpdated = (payload: RealtimeMessageThreadUpdated) => {
      if (payload.channelId !== channelId) return

      setLive((prev) => {
        const existing = prev.find(
          (a) => a.threadRootId === payload.threadRootId
        )
        const rest = prev.filter((a) => a.threadRootId !== payload.threadRootId)
        // Thread emptied (last reply deleted) → drop the live entry.
        if (payload.replyCount === 0 || !payload.lastReplyAt) return rest
        // Edits and deletes also emit this event without advancing
        // lastReplyAt — they must not inflate the unread count.
        const lastKnownReplyAt =
          existing?.lastReplyAt ??
          seedRef.current?.find((a) => a.threadRootId === payload.threadRootId)
            ?.lastReplyAt
        const isNewReply =
          !lastKnownReplyAt || payload.lastReplyAt > lastKnownReplyAt
        const newReplyCount = Math.min(
          (existing?.newReplyCount ?? 0) + (isNewReply ? 1 : 0),
          payload.replyCount
        )
        const lastReply: ThreadActivityReplyPreview | null = payload.lastReply
          ? {
              content: payload.lastReply.content,
              authorName:
                payload.lastReply.author.displayUsername ??
                payload.lastReply.author.name,
              hasAttachments: payload.lastReply.hasAttachments,
              mentions: payload.lastReply.mentions,
            }
          : null
        return [
          ...rest,
          {
            threadRootId: payload.threadRootId,
            replyCount: payload.replyCount,
            newReplyCount,
            lastReplyAt: payload.lastReplyAt,
            participants: payload.participants,
            lastReply,
          },
        ]
      })

      // A fresh reply is new activity — un-dismiss so it surfaces again,
      // unless it's the thread you're actively viewing.
      if (payload.threadRootId !== suppressThreadRootId) {
        setDismissed((prev) => {
          if (!prev.has(payload.threadRootId)) return prev
          const next = new Set(prev)
          next.delete(payload.threadRootId)
          return next
        })
      }
    }

    socket.on("message:thread:updated", handleThreadUpdated)
    return () => {
      socket.off("message:thread:updated", handleThreadUpdated)
    }
  }, [socket, channelId, suppressThreadRootId])

  // Read on another device (or persisted here) — clear it everywhere. A reply
  // arriving after this re-surfaces the thread via the un-dismiss above.
  useEffect(() => {
    if (!socket) return

    const handleThreadRead = (payload: ThreadReadUpdated) => {
      if (payload.channelId !== channelId) return
      dismiss(payload.threadRootId)
    }

    socket.on("thread-read:updated", handleThreadRead)
    return () => {
      socket.off("thread-read:updated", handleThreadRead)
    }
  }, [socket, channelId, dismiss])

  const activities = useMemo(() => {
    const byId = new Map<string, ThreadActivity>()
    for (const a of seed ?? []) {
      byId.set(a.threadRootId, {
        ...a,
        newReplyCount: readBaselines.has(a.threadRootId) ? 0 : a.newReplyCount,
      })
    }
    for (const a of live) {
      const existing = byId.get(a.threadRootId)
      if (!existing) {
        byId.set(a.threadRootId, a)
        continue
      }
      if (a.lastReplyAt >= existing.lastReplyAt) {
        byId.set(a.threadRootId, {
          ...a,
          newReplyCount: Math.min(
            existing.newReplyCount + a.newReplyCount,
            a.replyCount
          ),
        })
      }
    }
    for (const id of dismissed) byId.delete(id)
    if (suppressThreadRootId) byId.delete(suppressThreadRootId)
    return Array.from(byId.values())
      .filter((a) => a.newReplyCount > 0)
      .sort((x, y) => x.lastReplyAt.localeCompare(y.lastReplyAt))
      .slice(-MAX_ACTIVITIES)
  }, [seed, live, dismissed, readBaselines, suppressThreadRootId])

  return { activities, dismiss }
}
