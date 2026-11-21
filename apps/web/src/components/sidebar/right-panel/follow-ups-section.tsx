import { Cancel01Icon, Clock01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { useMentionCandidates } from "@/hooks/use-mention-candidates"
import { apiClient } from "@/lib/api-client"
import { toSearchPreviewText } from "@/lib/search-preview"

type WakeUp = { id: string; dueAt: string; note: string }

const wakeUpsKey = (channelId: string) =>
  ["channel-agent-wake-ups", channelId] as const

function formatDue(iso: string) {
  const due = new Date(iso)
  const time = due.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
  if (due.toDateString() === new Date().toDateString()) return time
  return `${due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`
}

// The follow-ups Lor set for itself with wake_up, beside the channel's Loops
// (reference/always-on-agents.md, decision 10): when it will look again and
// why. Anyone here can cancel one. Kept live by agent:wake-ups:updated.
export function FollowUpsSection({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  // The agent writes people as mention tokens in its notes.
  const people = useMentionCandidates(workspaceSlug, channelId, {
    broadcasts: false,
  })
  const { data } = useQuery({
    queryKey: wakeUpsKey(channelId),
    queryFn: async (): Promise<WakeUp[]> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-wake-ups"].$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to load follow-ups")
      return (await res.json()).wakeUps
    },
  })

  useEffect(() => {
    if (!socket) return
    const handleUpdated: ServerToClientEvents["agent:wake-ups:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({ queryKey: wakeUpsKey(channelId) })
    }
    socket.on("agent:wake-ups:updated", handleUpdated)
    return () => {
      socket.off("agent:wake-ups:updated", handleUpdated)
    }
  }, [socket, queryClient, channelId])

  const cancel = useMutation({
    mutationFn: async (wakeUpId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-wake-ups"][":wakeUpId"].$delete({
        param: { workspaceSlug, channelId, wakeUpId },
      })
      if (!res.ok) throw new Error("Failed to cancel the follow-up")
      return wakeUpId
    },
    onSuccess: (wakeUpId) =>
      queryClient.setQueryData<WakeUp[]>(wakeUpsKey(channelId), (list) =>
        list?.filter((wakeUp) => wakeUp.id !== wakeUpId)
      ),
    onError: (error) => toast.error(error.message),
  })

  const wakeUps = data ?? []
  if (wakeUps.length === 0) return null
  const readable = (note: string) =>
    toSearchPreviewText(
      note,
      people.map((person) => ({
        id: person.id,
        name: person.name ?? person.label,
      })),
      { dropUnresolvedMentions: true }
    )
  return (
    <section className="border-t border-border/60 pt-3">
      <div className="pb-1 pl-1">
        <span className="font-medium text-xs text-muted-foreground">
          Follow-ups · {wakeUps.length}
        </span>
      </div>
      <div className="space-y-0.5">
        {wakeUps.map((wakeUp) => (
          <div
            key={wakeUp.id}
            className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04]"
          >
            <HugeiconsIcon
              icon={Clock01Icon}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5">
                Lor checks back {formatDue(wakeUp.dueAt)}
              </p>
              <p
                title={readable(wakeUp.note)}
                className="line-clamp-2 text-muted-foreground text-xs"
              >
                {readable(wakeUp.note)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancel follow-up"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(wakeUp.id)}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
