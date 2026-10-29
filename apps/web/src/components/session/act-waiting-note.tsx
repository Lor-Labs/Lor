import { Clock01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// Automation events waiting while this session has a run going or a
// person's message queued (reference/act-sessions-runbook.md). People go
// first; the events run after, unless someone drops them.

const actWaitingKey = (sessionId: string) => ["act-waiting", sessionId] as const

export function ActWaitingNote({
  sessionId,
  threadRootId,
}: {
  sessionId: string
  threadRootId: string
}) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: actWaitingKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"]["act-waiting"].$get(
        { param: { sessionId } }
      )
      if (!res.ok) throw new Error("Failed to load waiting events")
      return res.json()
    },
  })

  useEffect(() => {
    if (!socket) return
    const onWaiting = (payload: { threadRootId: string }) => {
      if (payload.threadRootId !== threadRootId) return
      void queryClient.invalidateQueries({
        queryKey: actWaitingKey(sessionId),
      })
    }
    socket.on("session:act-waiting", onWaiting)
    return () => {
      socket.off("session:act-waiting", onWaiting)
    }
  }, [socket, queryClient, sessionId, threadRootId])

  const drop = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"][
        "act-waiting"
      ].drop.$post({ param: { sessionId } })
      if (!res.ok) throw new Error("Failed to drop waiting events")
      return res.json()
    },
    onSuccess: () => {
      queryClient.setQueryData(actWaitingKey(sessionId), { count: 0 })
    },
    onError: () => toast.error("Couldn't drop the waiting events"),
  })

  const count = data?.count ?? 0
  if (count === 0) return null
  return (
    <div className="flex items-center gap-2 pb-2 text-muted-foreground text-xs">
      <HugeiconsIcon icon={Clock01Icon} className="size-3" strokeWidth={2} />
      <span>
        {count === 1 ? "1 event waits" : `${count} events wait`} for this
        conversation to finish
      </span>
      <button
        type="button"
        className="cursor-pointer transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
        disabled={drop.isPending}
        onClick={() => drop.mutate()}
      >
        Drop
      </button>
    </div>
  )
}
