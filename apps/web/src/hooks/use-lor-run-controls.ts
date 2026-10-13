import type { QueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useLorRunReplay } from "@/hooks/use-lor-stream"
import { useQueuedMessageSteering } from "@/hooks/use-queued-message-steering"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useStopLorRun } from "@/hooks/use-stop-lor-run"
import { isOptimisticLorTurn } from "@/hooks/use-thread-messages"
import type { Message } from "@/lib/api-types"
import type { AppSocket } from "@/lib/socket"

// Lor's live turn in a conversation: its pending reply, Stop, the messages
// queued behind the run (steer or remove them), and replay of a run that
// was already going when the conversation opened.
export function useLorRunControls({
  socket,
  queryClient,
  channelId,
  threadRootId,
  messages,
  rootMessage,
  currentUserId,
  pendingNonces,
}: {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
  threadRootId: string
  // Newest first, as the thread cache holds them.
  messages: Message[]
  rootMessage: Message | null
  currentUserId: string | undefined
  pendingNonces: { current: Set<string> }
}) {
  // Opening a conversation mid-run replays the durable trace into its cache.
  useLorRunReplay({
    queryClient,
    channelId,
    messages: rootMessage ? [rootMessage, ...messages] : messages,
  })

  const pendingLorMessage = useMemo(
    () => messages.find((message) => message.status === "pending"),
    [messages]
  )
  const pendingLorMessageId = pendingLorMessage?.id
  // The local Lor turn shown on send has no server id yet.
  const serverPendingLorId =
    pendingLorMessageId && !isOptimisticLorTurn(pendingLorMessageId)
      ? pendingLorMessageId
      : undefined

  const stopLor = useStopLorRun()
  const stopLorRun = stopLor.mutate
  // Stop pressed before Lor's real turn arrived: sent once it does.
  const [stopOnStart, setStopOnStart] = useState(false)
  useEffect(() => {
    if (!stopOnStart) return
    if (!pendingLorMessage) setStopOnStart(false)
    else if (serverPendingLorId) {
      stopLorRun(pendingLorMessage)
      setStopOnStart(false)
    }
  }, [stopOnStart, pendingLorMessage, serverPendingLorId, stopLorRun])
  const onStop = pendingLorMessage
    ? () =>
        serverPendingLorId
          ? stopLorRun(pendingLorMessage)
          : setStopOnStart(true)
    : undefined
  const isStopping =
    stopLor.isPending ||
    stopOnStart ||
    Boolean(pendingLorMessage?.stopRequested)

  const { queuedIds, addOptimistic, removeOptimistic } = useRunQueue({
    socket,
    channelId,
    threadRootId,
    pendingLorMessageId: serverPendingLorId,
  })
  const queuedMessages = useMemo(
    () =>
      queuedIds
        .map((id) => messages.find((m) => m.id === id))
        .filter((m): m is Message => Boolean(m)),
    [queuedIds, messages]
  )
  const steering = useQueuedMessageSteering({
    messages: queuedMessages,
    currentUserId,
    pendingNonces,
  })

  return {
    pendingLorMessage,
    onStop,
    isStopping,
    queuedIds,
    queuedMessages,
    addOptimistic,
    removeOptimistic,
    steering,
  }
}
