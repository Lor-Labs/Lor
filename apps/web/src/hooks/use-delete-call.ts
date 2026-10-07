import { toast } from "@repo/ui/components/toast"
import { type InfiniteData, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import {
  type VoiceSessionSummary,
  voiceSessionsQueryKey,
} from "@/hooks/use-voice-sessions"
import { apiClient } from "@/lib/api-client"

// How long Undo is offered. The delete is only sent once it passes, so Undo
// simply never sends it.
const UNDO_MS = 10_000

// Calls hidden while their delete waits out the window or is in flight, so a
// refetch of the list can't bring one back.
const hiddenCalls = new Set<string>()
// Deletes still in their window. Leaving the page sends them at once: a
// delete the person let stand is never dropped.
const waiting = new Map<string, () => void>()
window.addEventListener("pagehide", () => {
  for (const send of [...waiting.values()]) send()
})

export function isCallBeingDeleted(sessionId: string) {
  return hiddenCalls.has(sessionId)
}

type SessionsData = InfiniteData<{ sessions: VoiceSessionSummary[] }>

export function useDeleteCall(workspaceSlug: string, channelId: string) {
  const queryClient = useQueryClient()
  const { view, setView } = useRightSidebar()

  return useCallback(
    (session: VoiceSessionSummary) => {
      const queryKey = voiceSessionsQueryKey(channelId)
      const bringBack = () => {
        hiddenCalls.delete(session.id)
        void queryClient.invalidateQueries({ queryKey })
      }
      hiddenCalls.add(session.id)
      queryClient.setQueryData<SessionsData>(queryKey, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                sessions: page.sessions.filter(
                  (other) => other.id !== session.id
                ),
              })),
            }
          : data
      )
      if (
        view?.type === "thread" &&
        view.threadRootId === session.threadRootId
      ) {
        setView({ type: "workspace-members", workspaceSlug, channelId })
      }

      const send = () => {
        clearTimeout(timer)
        waiting.delete(session.id)
        void apiClient.v1.workspaces[":workspaceSlug"].voice.sessions[
          ":sessionId"
        ]
          .$delete(
            { param: { workspaceSlug, sessionId: session.id } },
            { init: { keepalive: true } }
          )
          .then((res) => {
            if (!res.ok) throw new Error(`delete failed: ${res.status}`)
          })
          .catch(() => {
            toast.error("Couldn't delete the call")
            bringBack()
          })
      }
      const timer = setTimeout(send, UNDO_MS)
      waiting.set(session.id, send)

      toast("Call deleted", {
        description: "Chat, transcript, and summary too.",
        timeout: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            clearTimeout(timer)
            waiting.delete(session.id)
            bringBack()
          },
        },
      })
    },
    [workspaceSlug, channelId, queryClient, view, setView]
  )
}
