import type { LorToolEventPayload } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// A code session's Changes panel: git state read from the session's sandbox
// (reference/planned/code-sessions-runbook.md, chunk 3).

// Lor's tool calls finish in bursts; one refresh after a burst is enough.
const TOOL_REFRESH_MS = 1_500

export const sessionChangesKey = (sessionId: string) =>
  ["session-changes", sessionId] as const

export function sessionChangesQueryOptions(sessionId: string) {
  return {
    queryKey: sessionChangesKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].changes.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Failed to load changes")
      return res.json()
    },
  }
}

export function useSessionChanges(sessionId: string) {
  return useQuery(sessionChangesQueryOptions(sessionId))
}

export type SessionChanges = NonNullable<
  ReturnType<typeof useSessionChanges>["data"]
>
export type ReadyChanges = Extract<SessionChanges, { state: "ready" }>
export type ChangedFile = ReadyChanges["files"][number]

// Files change while Lor works: refresh as its tool calls finish, and once
// more when its reply ends.
export function useLiveSessionChanges(sessionId: string, threadRootId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: sessionChangesKey(sessionId),
        })
      }, delay)
    }
    const onTool = (payload: LorToolEventPayload) => {
      if (payload.threadRootId === threadRootId && payload.toolCall.status) {
        refresh(TOOL_REFRESH_MS)
      }
    }
    const onStream = (payload: {
      threadRootId: string | null
      done: boolean
    }) => {
      if (payload.threadRootId === threadRootId && payload.done) refresh(0)
    }
    socket.on("lor:tool", onTool)
    socket.on("message:stream", onStream)
    return () => {
      socket.off("lor:tool", onTool)
      socket.off("message:stream", onStream)
      if (timer) clearTimeout(timer)
    }
  }, [socket, queryClient, sessionId, threadRootId])
}

export function useChangeDiff(
  sessionId: string,
  file: ChangedFile,
  staged: boolean,
  // Refetch whenever the file list refreshes: the file may have changed.
  version: number
) {
  return useQuery({
    queryKey: [
      "session-change-diff",
      sessionId,
      file.path,
      file.oldPath,
      staged,
      version,
    ],
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].changes.diff.$get({
        param: { sessionId },
        query: {
          path: file.path,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
          staged: String(staged) as "true" | "false",
          ...(file.status === "untracked"
            ? { untracked: "true" as const }
            : {}),
        },
      })
      if (!res.ok) throw new Error("Failed to load the diff")
      return res.json()
    },
    placeholderData: (previous) => previous,
  })
}

type StageInput = { staged: boolean } & (
  | { paths: string[]; all?: never }
  | { all: true; paths?: never }
)

export function useStageChanges(sessionId: string) {
  const queryClient = useQueryClient()
  const key = sessionChangesKey(sessionId)
  return useMutation({
    mutationFn: async (input: StageInput) => {
      const res = await apiClient.v1.sessions[":sessionId"].changes.stage.$post(
        { param: { sessionId }, json: input }
      )
      if (res.status === 409) {
        throw new Error(
          "Lor is working in this session. Try again when it finishes."
        )
      }
      if (!res.ok) throw new Error("Couldn't update the staged files")
      return res.json()
    },
    // The file moves between lists at once; the response is the truth.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<SessionChanges>(key)
      if (previous?.state === "ready") {
        const touched = (file: ChangedFile) =>
          input.all || input.paths?.includes(file.path)
        queryClient.setQueryData<SessionChanges>(key, {
          ...previous,
          files: previous.files.map((file) =>
            touched(file)
              ? { ...file, staged: input.staged, unstaged: !input.staged }
              : file
          ),
        })
      }
      return { previous }
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(err.message)
    },
    onSuccess: (changes) => {
      queryClient.setQueryData(key, changes)
    },
  })
}

export function useCommitMessage(sessionId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.sessions[
        ":sessionId"
      ].changes.message.$post({ param: { sessionId } })
      if (!res.ok) throw new Error("Couldn't write a commit message")
      const { message } = await res.json()
      if (!message) throw new Error("Stage some changes first")
      return message
    },
    onError: (err) => toast.error(err.message),
  })
}
