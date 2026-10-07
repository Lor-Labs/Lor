import { workspaceAuthorityHasPermissions } from "@repo/auth/permissions"
import {
  type InfiniteData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useToast } from "heroui-native/toast"
import { useCallback } from "react"
import { AppState } from "react-native"
import { useActiveMember } from "@/hooks/use-active-member"
import {
  type VoiceSessionSummary,
  voiceSessionsQueryKey,
} from "@/hooks/use-voice-sessions"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

// How long Undo is offered. The delete is only sent once it passes, so Undo
// simply never sends it. Same as web.
const UNDO_MS = 10_000

// Calls hidden while their delete waits out the window or is in flight, so a
// refetch of the list can't bring one back.
const hiddenCalls = new Set<string>()
// Deletes still in their window. Leaving the app sends them at once: a delete
// the person let stand is never dropped.
const waiting = new Map<string, () => void>()
AppState.addEventListener("change", (state) => {
  if (state !== "background") return
  for (const send of [...waiting.values()]) send()
})

export function isCallBeingDeleted(sessionId: string) {
  return hiddenCalls.has(sessionId)
}

// Web's canDeleteVoiceCalls. Custom roles count as members here, as in
// useMemberModeration; the server enforces the real grant.
export function useCanDeleteCalls(
  workspaceId: string | undefined,
  workspaceSlug: string | undefined
) {
  const { data: auth } = authClient.useSession()
  const activeMember = useActiveMember(workspaceId)
  // Deduped with useWorkspaceMembers; only read for ownerId.
  const { data: members } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    enabled: Boolean(workspaceSlug),
    queryFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug ?? "" },
      })
      if (!res.ok) throw new Error("Could not load workspace members")
      return res.json()
    },
  })
  const role = activeMember.data?.role
  if (typeof role !== "string" || !auth?.user || !members) return false
  return workspaceAuthorityHasPermissions(
    { role, isOwner: members.ownerId === auth.user.id },
    { voice: ["delete"] }
  )
}

type SessionsData = InfiniteData<{ sessions: VoiceSessionSummary[] }>

export function useDeleteCall(
  channelId: string,
  workspaceSlug: string | undefined
) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useCallback(
    (session: VoiceSessionSummary) => {
      if (!workspaceSlug) return
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

      const send = () => {
        clearTimeout(timer)
        waiting.delete(session.id)
        void api.v1.workspaces[":workspaceSlug"].voice.sessions[":sessionId"]
          .$delete({ param: { workspaceSlug, sessionId: session.id } })
          .then((res) => {
            if (!res.ok) throw new Error(`delete failed: ${res.status}`)
          })
          .catch(() => {
            toast.show({ variant: "danger", label: "Couldn't delete the call" })
            bringBack()
          })
      }
      const timer = setTimeout(send, UNDO_MS)
      waiting.set(session.id, send)

      const toastId = toast.show({
        label: "Call deleted",
        description: "Chat, transcript, and summary too.",
        duration: UNDO_MS,
        actionLabel: "Undo",
        onActionPress: ({ hide }) => {
          clearTimeout(timer)
          waiting.delete(session.id)
          bringBack()
          hide(toastId)
        },
      })
    },
    [channelId, workspaceSlug, queryClient, toast]
  )
}
