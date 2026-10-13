import type { ServerToClientEvents } from "@repo/realtime-types"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { apiClient } from "@/lib/api-client"
import type { AppSocket } from "@/lib/socket"

const NO_QUEUE: string[] = []

export const runQueueKey = (channelId: string, threadRootId: string | null) =>
  ["run-queue", channelId, threadRootId] as const

// Steer and Remove take a message out of the queue before the server
// answers; returns the list to restore if the request fails.
export function takeFromRunQueue(
  queryClient: QueryClient,
  message: { id: string; channelId: string; threadRootId: string | null }
) {
  const queryKey = runQueueKey(message.channelId, message.threadRootId)
  const previous = queryClient.getQueryData<string[]>(queryKey)
  queryClient.setQueryData<string[]>(queryKey, (current = []) =>
    current.filter((id) => id !== message.id)
  )
  return previous
}

// Queued-message ids for one scope (thread, or channel when threadRootId is
// null), in arrival order — the composer pill's state. It lives in the query
// cache so Steer and Remove can take a row out optimistically; gcTime 0
// starts a remounted panel empty, as local state did. Sends land optimistic
// via addOptimistic (id = the send nonce, swapped for the real id on the
// message:created echo), confirmations ride message:routed (outcome
// "queued"), removals ride run:queue:updated (drained/rejected/withdrawn);
// late joins rebuild from the run's queue snapshot on the events endpoint.
export function useRunQueue({
  socket,
  channelId,
  threadRootId,
  pendingLorMessageId,
}: {
  socket: AppSocket | null
  channelId: string
  threadRootId: string | null
  pendingLorMessageId: string | undefined
}) {
  const queryClient = useQueryClient()
  const { data: queuedIds } = useQuery({
    queryKey: runQueueKey(channelId, threadRootId),
    queryFn: () =>
      queryClient.getQueryData<string[]>(
        runQueueKey(channelId, threadRootId)
      ) ?? NO_QUEUE,
    initialData: NO_QUEUE,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })
  const setQueuedIds = useCallback(
    (update: (current: string[]) => string[]) =>
      queryClient.setQueryData<string[]>(
        runQueueKey(channelId, threadRootId),
        (current = NO_QUEUE) => update(current)
      ),
    [queryClient, channelId, threadRootId]
  )

  const addOptimistic = useCallback(
    (id: string) => {
      setQueuedIds((current) =>
        current.includes(id) ? current : [...current, id]
      )
    },
    [setQueuedIds]
  )

  // Undo an optimistic add whose send failed — the nonce would otherwise
  // linger and hide the real message if a delayed created echo swaps it in.
  const removeOptimistic = useCallback(
    (id: string) => {
      setQueuedIds((current) => current.filter((queuedId) => queuedId !== id))
    },
    [setQueuedIds]
  )

  useEffect(() => {
    if (!socket) return
    const handleRouted: ServerToClientEvents["message:routed"] = (payload) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      // Only "queued" belongs in the pill; any other outcome (e.g. a
      // channel-scope steer) clears an optimistic entry so the message isn't
      // stuck hidden from the transcript.
      setQueuedIds((current) => {
        if (payload.outcome !== "queued") {
          return current.filter((id) => id !== payload.messageId)
        }
        return current.includes(payload.messageId)
          ? current
          : [...current, payload.messageId]
      })
    }
    const handleQueueUpdated: ServerToClientEvents["run:queue:updated"] = (
      payload
    ) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      setQueuedIds((current) =>
        current.filter((id) => id !== payload.messageId)
      )
    }
    // An optimistic entry still carries its send nonce — swap in the real id
    // so the row survives the transcript's own nonce reconciliation.
    const handleCreated: ServerToClientEvents["message:created"] = (
      message
    ) => {
      const nonce = message.nonce
      if (message.channelId !== channelId || !nonce) return
      setQueuedIds((current) =>
        current.includes(nonce)
          ? current.map((id) => (id === nonce ? message.id : id))
          : current
      )
    }
    // A queued message deleted from elsewhere (another device) leaves the
    // queue with it.
    const handleDeleted: ServerToClientEvents["message:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setQueuedIds((current) =>
        current.filter((id) => id !== payload.messageId)
      )
    }
    socket.on("message:routed", handleRouted)
    socket.on("run:queue:updated", handleQueueUpdated)
    socket.on("message:created", handleCreated)
    socket.on("message:deleted", handleDeleted)
    return () => {
      socket.off("message:routed", handleRouted)
      socket.off("run:queue:updated", handleQueueUpdated)
      socket.off("message:created", handleCreated)
      socket.off("message:deleted", handleDeleted)
    }
  }, [socket, channelId, threadRootId, setQueuedIds])

  // Late-join snapshot, keyed by the active run's placeholder. `after` skips
  // the event log itself — only the queue rows are needed here (the replay
  // hook owns the trace).
  useEffect(() => {
    if (!pendingLorMessageId) return
    let cancelled = false
    void apiClient.v1.runs["by-message"][":messageId"].events
      .$get({
        param: { messageId: pendingLorMessageId },
        // Postgres int4 max — seq is an integer column, so a larger sentinel
        // would overflow the parameter. No real run reaches this many events.
        query: { after: "2147483647" },
      })
      .then(async (res) => (res.ok ? await res.json() : null))
      .then((data) => {
        if (!data || cancelled || data.queue.length === 0) return
        setQueuedIds((current) => [
          ...current,
          ...data.queue
            .map((q) => q.messageId)
            .filter((id) => !current.includes(id)),
        ])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pendingLorMessageId, setQueuedIds])

  return { queuedIds, addOptimistic, removeOptimistic }
}
