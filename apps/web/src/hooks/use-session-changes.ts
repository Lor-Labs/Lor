import { authClient } from "@repo/auth/client"
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

// Live for everyone with the session open: files refresh as Lor's tool calls
// finish and when its run ends; the "Lor is working" lock when a run starts
// and ends; staging when someone else stages. The session page runs it for
// the panel and tabs.
export function useLiveSessionChanges(
  sessionId: string,
  threadRootId: string,
  enabled: boolean
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const userId = auth?.user.id
  useEffect(() => {
    if (!socket || !enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const invalidate = (files: boolean) => {
      void queryClient.invalidateQueries({
        queryKey: sessionChangesKey(sessionId),
      })
      if (!files) return
      void queryClient.invalidateQueries({ queryKey: repoTreeKey(sessionId) })
      void queryClient.invalidateQueries({ queryKey: ["repo-file", sessionId] })
    }
    const refresh = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => invalidate(true), delay)
    }
    const onTool = (payload: LorToolEventPayload) => {
      if (payload.threadRootId === threadRootId && payload.toolCall.status) {
        refresh(TOOL_REFRESH_MS)
      }
    }
    // A reply's first frame means a run started: lock staging.
    const started = new Set<string>()
    const onStream = (payload: {
      threadRootId: string | null
      messageId: string
      done: boolean
    }) => {
      if (payload.threadRootId !== threadRootId) return
      if (payload.done) {
        refresh(0)
      } else if (!started.has(payload.messageId)) {
        started.add(payload.messageId)
        invalidate(false)
      }
    }
    // The run row is terminal only after the stream's done frame.
    const onSettled = (payload: { threadRootId: string }) => {
      if (payload.threadRootId === threadRootId) refresh(0)
    }
    const onStaged = (payload: { sessionId: string; byUserId: string }) => {
      if (payload.sessionId === sessionId && payload.byUserId !== userId) {
        invalidate(false)
      }
    }
    socket.on("lor:tool", onTool)
    socket.on("message:stream", onStream)
    socket.on("run:settled", onSettled)
    socket.on("session:changes:updated", onStaged)
    return () => {
      socket.off("lor:tool", onTool)
      socket.off("message:stream", onStream)
      socket.off("run:settled", onSettled)
      socket.off("session:changes:updated", onStaged)
      if (timer) clearTimeout(timer)
    }
  }, [socket, queryClient, sessionId, threadRootId, enabled, userId])
}

// The file's changes against HEAD, staged and unstaged together.
export function useChangeDiff(
  sessionId: string,
  file: ChangedFile,
  // Refetch whenever the file list refreshes: the file may have changed.
  version: number
) {
  return useQuery({
    queryKey: [
      "session-change-diff",
      sessionId,
      file.path,
      file.oldPath,
      version,
    ],
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].changes.diff.$get({
        param: { sessionId },
        query: {
          path: file.path,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
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

// ── Files tab ─────────────────────────────────────────

export const repoTreeKey = (sessionId: string) =>
  ["repo-tree", sessionId] as const

export function useRepoTree(sessionId: string) {
  return useQuery({
    queryKey: repoTreeKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].repo.tree.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Failed to load the files")
      return res.json()
    },
  })
}

export function useRepoFile(sessionId: string, path: string) {
  return useQuery({
    queryKey: ["repo-file", sessionId, path],
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].repo.file.$get({
        param: { sessionId },
        query: { path },
      })
      if (!res.ok) throw new Error("Failed to load the file")
      return res.json()
    },
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

// Commits the staged files as the person's linked GitHub account.
export function useCommitChanges(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (message: string) => {
      const res = await apiClient.v1.sessions[
        ":sessionId"
      ].changes.commit.$post({ param: { sessionId }, json: { message } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't commit")
      }
      return res.json()
    },
    onSuccess: ({ changes }) =>
      queryClient.setQueryData(sessionChangesKey(sessionId), changes),
    onError: (err) => toast.error(err.message),
  })
}

// Pushes the session's commits to the same branch on GitHub, as the person.
export function usePushChanges(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].changes.push.$post({
        param: { sessionId },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't push")
      }
      return res.json()
    },
    onSuccess: ({ pushed, changes }) => {
      queryClient.setQueryData(sessionChangesKey(sessionId), changes)
      toast.success(`Pushed to ${pushed.branch}`)
    },
    onError: (err) => toast.error(err.message),
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
