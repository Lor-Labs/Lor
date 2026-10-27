import type { LorToolEventPayload } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

// A code session's Changes drawer: git state read from the session's sandbox
// (reference/planned/code-sessions-runbook.md, chunk 3). Mirrors web's
// use-session-changes.ts; same query keys.

// Lor's tool calls finish in bursts; one refresh after a burst is enough.
const TOOL_REFRESH_MS = 1_500

export const sessionChangesKey = (sessionId: string) =>
  ["session-changes", sessionId] as const

export function useSessionChanges(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: sessionChangesKey(sessionId),
    queryFn: async () => {
      const res = await api.v1.sessions[":sessionId"].changes.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Failed to load changes")
      return res.json()
    },
    enabled,
  })
}

export type SessionChanges = NonNullable<
  ReturnType<typeof useSessionChanges>["data"]
>
export type ReadyChanges = Extract<SessionChanges, { state: "ready" }>
export type ChangedFile = ReadyChanges["files"][number]

export function changeTotals(files: ChangedFile[]) {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  )
}

// Live while the session is open: files refresh as Lor's tool calls finish
// and when its run ends; the "Lor is working" lock when a run starts and
// ends; staging when someone else stages.
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
      void queryClient.invalidateQueries({ queryKey: ["repo-tree", sessionId] })
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
    const onStaged = (payload: {
      sessionId: string
      byUserId: string
      filesChanged?: boolean
    }) => {
      if (payload.sessionId === sessionId && payload.byUserId !== userId) {
        invalidate(Boolean(payload.filesChanged))
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

// The repo's files (tracked and untracked, without ignored ones) for the
// Files tab.
export function useRepoTree(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo-tree", sessionId],
    queryFn: async () => {
      const res = await api.v1.sessions[":sessionId"].repo.tree.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Failed to load the files")
      return res.json()
    },
    enabled,
  })
}

export function useRepoFile(sessionId: string, path: string) {
  return useQuery({
    queryKey: ["repo-file", sessionId, path],
    queryFn: async () => {
      const res = await api.v1.sessions[":sessionId"].repo.file.$get({
        param: { sessionId },
        query: { path },
      })
      if (!res.ok) throw new Error("Failed to load the file")
      return res.json()
    },
  })
}

// An image in the repo, loaded by the image view with the session cookie.
export function repoImageSource(sessionId: string, path: string) {
  const cookie = authClient.getCookie()
  return {
    uri: api.v1.sessions[":sessionId"].repo.image
      .$url({ param: { sessionId }, query: { path } })
      .toString(),
    ...(cookie ? { headers: { cookie } } : {}),
  }
}

// The file's changes against HEAD, staged and unstaged together.
export function useChangeDiff(
  sessionId: string,
  file: ChangedFile | null,
  // Refetch whenever the file list refreshes: the file may have changed.
  version: number
) {
  return useQuery({
    queryKey: [
      "session-change-diff",
      sessionId,
      file?.path,
      file?.oldPath,
      version,
    ],
    queryFn: async () => {
      if (!file) throw new Error("No file")
      const res = await api.v1.sessions[":sessionId"].changes.diff.$get({
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
    enabled: file !== null,
    placeholderData: (previous) => previous,
  })
}
