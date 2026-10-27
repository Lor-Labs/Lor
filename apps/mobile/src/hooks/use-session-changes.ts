import type { LorToolEventPayload } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useToast } from "heroui-native/toast"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api, responseMessage } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { openExternalUrl } from "@/lib/open-url"

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

type StageInput = { staged: boolean } & (
  | { paths: string[]; all?: never }
  | { all: true; paths?: never }
)

export function useStageChanges(sessionId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const key = sessionChangesKey(sessionId)
  return useMutation({
    mutationFn: async (input: StageInput) => {
      const res = await api.v1.sessions[":sessionId"].changes.stage.$post({
        param: { sessionId },
        json: input,
      })
      if (res.status === 409) {
        throw new Error(
          "Lor is working in this session. Try again when it finishes."
        )
      }
      if (!res.ok) throw new Error("Couldn't update the staged files")
      return res.json()
    },
    // The file moves at once; the response is the truth.
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
      toast.show({ label: err.message, variant: "danger" })
    },
    onSuccess: (changes) => queryClient.setQueryData(key, changes),
  })
}

// Commits the staged files as the person's linked GitHub account.
export function useCommitChanges(sessionId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: async (message: string) => {
      const res = await api.v1.sessions[":sessionId"].changes.commit.$post({
        param: { sessionId },
        json: { message },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't commit"))
      return res.json()
    },
    onSuccess: ({ changes }) =>
      queryClient.setQueryData(sessionChangesKey(sessionId), changes),
    onError: (err) => toast.show({ label: err.message, variant: "danger" }),
  })
}

// Brings GitHub's new commits into the session. Conflicts stay in the files
// for the session (or Lor) to fix, then Commit finishes the merge.
export function usePullChanges(sessionId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: async () => {
      const res = await api.v1.sessions[":sessionId"].changes.pull.$post({
        param: { sessionId },
      })
      if (!res.ok) throw new Error(await responseMessage(res, "Couldn't pull"))
      return res.json()
    },
    onSuccess: ({ pulled, changes }) => {
      queryClient.setQueryData(sessionChangesKey(sessionId), changes)
      if (pulled.commitCount > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["repo-tree", sessionId],
        })
        void queryClient.invalidateQueries({
          queryKey: ["repo-file", sessionId],
        })
      }
      const commits = `${pulled.commitCount} ${pulled.commitCount === 1 ? "commit" : "commits"}`
      toast.show(
        pulled.outcome === "conflicts"
          ? {
              label: `Pulled ${commits} with conflicts`,
              description: `Fix ${pulled.conflicts.length} ${pulled.conflicts.length === 1 ? "file" : "files"}, stage them, then commit.`,
              variant: "danger",
            }
          : {
              label:
                pulled.outcome === "up_to_date"
                  ? "Already up to date"
                  : `Pulled ${commits}`,
              variant: "success",
            }
      )
    },
    onError: (err) => toast.show({ label: err.message, variant: "danger" }),
  })
}

// GitHub's branch moved on: the toast offers to pull, then push again.
class BehindError extends Error {}

// Pushes the session's commits to the same branch on GitHub, as the person;
// the toast then offers the branch's pull request.
export function usePushChanges(sessionId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const pull = usePullChanges(sessionId)
  const push = useMutation({
    mutationFn: async () => {
      const res = await api.v1.sessions[":sessionId"].changes.push.$post({
        param: { sessionId },
      })
      if (res.status === 409) {
        throw new BehindError(await responseMessage(res, "Pull first"))
      }
      if (!res.ok) throw new Error(await responseMessage(res, "Couldn't push"))
      return res.json()
    },
    onSuccess: ({ pushed, pullRequest, changes }) => {
      queryClient.setQueryData(sessionChangesKey(sessionId), changes)
      toast.show({
        label: `Pushed ${pushed.branch} to GitHub`,
        variant: "success",
        ...(pullRequest
          ? {
              actionLabel: pullRequest.open
                ? "View pull request"
                : "Create pull request",
              onActionPress: ({ hide }) => {
                hide("all")
                openExternalUrl(pullRequest.url)
              },
            }
          : {}),
      })
    },
    onError: (err) => {
      toast.show({
        label: err.message,
        variant: "danger",
        ...(err instanceof BehindError
          ? {
              actionLabel: "Pull and push",
              onActionPress: ({ hide }) => {
                hide("all")
                pull.mutate(undefined, {
                  onSuccess: ({ pulled }) => {
                    if (pulled.outcome !== "conflicts") push.mutate()
                  },
                })
              },
            }
          : {}),
      })
    },
  })
  return push
}

// The model's commit message for the staged changes.
export function useCommitMessage(sessionId: string) {
  const { toast } = useToast()
  return useMutation({
    mutationFn: async () => {
      const res = await api.v1.sessions[":sessionId"].changes.message.$post({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Couldn't write a commit message")
      const { message } = await res.json()
      if (!message) throw new Error("Stage some changes first")
      return message
    },
    onError: (err) => toast.show({ label: err.message, variant: "danger" }),
  })
}
