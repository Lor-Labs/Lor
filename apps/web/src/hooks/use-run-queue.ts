import type { ServerToClientEvents } from "@repo/realtime-types"
import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { AppSocket } from "@/lib/socket"

// Queued-message ids for one scope (thread, or channel when threadRootId is
// null), in arrival order — the composer pill's state. Sends land optimistic
// via addOptimistic (id = the send nonce, swapped for the real id on the
// message:created echo), confirmations ride message:routed (outcome
// "queued"), removals ride run:queue:updated (drained/rejected/withdrawn);
// late joins rebuild from the run's queue snapshot on the events endpoint.
export function useRunQueue({
  socket,
  channelId,
  threadRootId,
  pendingMerlinMessageId,
}: {
  socket: AppSocket | null
  channelId: string
  threadRootId: string | null
  pendingMerlinMessageId: string | undefined
}) {
  const [queuedIds, setQueuedIds] = useState<string[]>([])
  const [scope, setScope] = useState(threadRootId)
  if (scope !== threadRootId) {
    setScope(threadRootId)
    setQueuedIds([])
  }

  const addOptimistic = useCallback((id: string) => {
    setQueuedIds((current) =>
      current.includes(id) ? current : [...current, id]
    )
  }, [])

  // Undo an optimistic add whose send failed — the nonce would otherwise
  // linger and hide the real message if a delayed created echo swaps it in.
  const removeOptimistic = useCallback((id: string) => {
    setQueuedIds((current) => current.filter((queuedId) => queuedId !== id))
  }, [])

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
  }, [socket, channelId, threadRootId])

  // Late-join snapshot, keyed by the active run's placeholder. `after` skips
  // the event log itself — only the queue rows are needed here (the replay
  // hook owns the trace).
  useEffect(() => {
    if (!pendingMerlinMessageId) return
    let cancelled = false
    void apiClient.v1.runs["by-message"][":messageId"].events
      .$get({
        param: { messageId: pendingMerlinMessageId },
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
  }, [pendingMerlinMessageId])

  return { queuedIds, addOptimistic, removeOptimistic }
}
