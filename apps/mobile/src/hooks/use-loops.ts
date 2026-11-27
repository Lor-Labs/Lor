import type { ServerToClientEvents } from "@repo/realtime-types"
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { useChannelRoom } from "@/hooks/use-channel-room"
import { api } from "@/lib/api"
import type { ChannelLoop } from "@/lib/api-types"

// Channel loop list, kept live by loop:updated (channel room; the channel
// screen's message hook already joins it). Mirrors web's use-channel-loops.
export function useChannelLoops(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  // loop:updated reaches the channel room; a loop page opened without the
  // channel screen under it holds the room itself (refcounted).
  useChannelRoom(socket, channelId)
  const query = useQuery({
    queryKey: ["channel-loops", channelId],
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await api.v1.channels[":channelId"].loops.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel loops")
      const payload = await res.json()
      return payload.loops
    },
  })

  useEffect(() => {
    if (!socket || !channelId) return
    const handleLoopUpdated: ServerToClientEvents["loop:updated"] = (
      payload
    ) => {
      // The list holds Loops reporting here and those whose card is here; one
      // that left both drops out.
      const here =
        payload.loop.channelId === channelId ||
        payload.cardChannelId === channelId
      if (here && !queryClient.getQueryData(["channel-loops", channelId])) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-loops", channelId],
        })
      }
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== payload.loop.id)
          return here ? [payload.loop, ...rest] : rest
        }
      )
    }
    const handleLoopDeleted: ServerToClientEvents["loop:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.filter((l) => l.id !== payload.loopId)
      )
    }
    socket.on("loop:updated", handleLoopUpdated)
    socket.on("loop:deleted", handleLoopDeleted)
    return () => {
      socket.off("loop:updated", handleLoopUpdated)
      socket.off("loop:deleted", handleLoopDeleted)
    }
  }, [socket, queryClient, channelId])

  return query
}

export function useLoopForCard(
  channelId: string,
  cardMessageId: string
): ChannelLoop | null {
  const { data } = useChannelLoops(channelId)
  return data?.find((l) => l.cardMessageId === cardMessageId) ?? null
}

// Activate a draft in the device timezone — same flow as web's quick Create
// Loop button (there's no tz picker on mobile; web's detail panel has it).
// A 422 requires_confirmation becomes a native Alert that resends with
// confirmHighFrequency.
export function useActivateLoop(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (opts: { confirm?: boolean }) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await api.v1.loops[":loopId"].activate.$post({
        param: { loopId: loop.id },
        json: {
          timezone,
          ...(opts.confirm ? { confirmHighFrequency: true } : {}),
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        return {
          kind: "needs_confirmation" as const,
          firesPerDay: body.firesPerDay,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to create the loop")
      }
      const body = await res.json()
      return { kind: "activated" as const, loop: body.loop }
    },
    onSuccess: (result) => {
      if (result.kind === "needs_confirmation") {
        Alert.alert(
          "Frequent schedule",
          `This loop runs up to ${result.firesPerDay} times a day. Each run uses Lor credits. Create it anyway?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Create Loop",
              onPress: () => mutation.mutate({ confirm: true }),
            },
          ]
        )
        return
      }
      // loop:updated also lands via the socket; setting directly makes the
      // flip immediate even on a slow connection.
      replaceLoop(queryClient, result.loop)
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't create the loop",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
  })
  return mutation
}

async function fetchLoopRuns(loopId: string) {
  const res = await api.v1.loops[":loopId"].runs.$get({ param: { loopId } })
  if (!res.ok) throw new Error("Failed to fetch loop runs")
  return res.json()
}

export type LoopRun = Awaited<ReturnType<typeof fetchLoopRuns>>["runs"][number]

// A loop's recent runs, newest scheduled fire first, and the session each
// run answered in. loop:updated (a run started or settled) refreshes it.
// Mirrors web's useLoopRuns.
export function useLoopRuns(loop: ChannelLoop | null) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const loopId = loop && loop.status !== "draft" ? loop.id : null
  useEffect(() => {
    if (!socket || !loopId) return
    const handleLoopUpdated: ServerToClientEvents["loop:updated"] = (
      payload
    ) => {
      if (payload.loop.id !== loopId) return
      void queryClient.invalidateQueries({ queryKey: ["loop-runs", loopId] })
    }
    socket.on("loop:updated", handleLoopUpdated)
    return () => {
      socket.off("loop:updated", handleLoopUpdated)
    }
  }, [socket, queryClient, loopId])
  return useQuery({
    queryKey: ["loop-runs", loopId ?? ""],
    enabled: loopId !== null,
    queryFn: () => fetchLoopRuns(loopId ?? ""),
  })
}

// A Loop is cached in three places: the list of each chat it shows in, the
// list of the agent it belongs to, and on its own for its page. As web's
// use-channel-loops.ts.
const LOOP_LISTS = [["channel-loops"], ["agent-loops"]] as const
export const loopKey = (loopId: string) => ["loop", loopId] as const
export const agentLoopsKey = (agentId: string) =>
  ["agent-loops", agentId] as const

// Loops carry no version, so a response or rollback can be older than a
// loop:updated that landed meanwhile: each mutation refetches when it settles.
const refetchLoops = (queryClient: QueryClient, loop: ChannelLoop | null) => {
  if (!loop) return
  for (const queryKey of LOOP_LISTS) {
    void queryClient.invalidateQueries({ queryKey })
  }
  void queryClient.invalidateQueries({ queryKey: loopKey(loop.id) })
}

// The server's copy of a Loop, written over every cached one. A list it is
// not in yet is read again: only the server knows whether it belongs there
// (a Loop moved to another chat, or handed to another agent).
function replaceLoop(queryClient: QueryClient, updated: ChannelLoop) {
  queryClient.setQueryData(loopKey(updated.id), updated)
  for (const queryKey of LOOP_LISTS) {
    queryClient.setQueriesData<ChannelLoop[]>({ queryKey }, (existing) =>
      existing?.map((loop) => (loop.id === updated.id ? updated : loop))
    )
  }
  for (const queryKey of [
    ...(updated.channelId ? [["channel-loops", updated.channelId]] : []),
    ...(updated.agentId ? [agentLoopsKey(updated.agentId)] : []),
  ]) {
    const list = queryClient.getQueryData<ChannelLoop[]>(queryKey)
    if (list && !list.some((loop) => loop.id === updated.id)) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}

// One Loop, for its page, live by loop:updated. `undefined` while loading,
// null when it is gone.
export function useLoop(loopId: string): {
  loop: ChannelLoop | null | undefined
  isError: boolean
  refetch: () => void
} {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket || !loopId) return
    const onUpdated: ServerToClientEvents["loop:updated"] = (payload) => {
      if (payload.loop.id === loopId) replaceLoop(queryClient, payload.loop)
    }
    const onDeleted: ServerToClientEvents["loop:deleted"] = (payload) => {
      if (payload.loopId === loopId)
        queryClient.setQueryData(loopKey(loopId), null)
    }
    socket.on("loop:updated", onUpdated)
    socket.on("loop:deleted", onDeleted)
    return () => {
      socket.off("loop:updated", onUpdated)
      socket.off("loop:deleted", onDeleted)
    }
  }, [socket, queryClient, loopId])
  const query = useQuery({
    queryKey: loopKey(loopId),
    enabled: loopId.length > 0,
    queryFn: async (): Promise<ChannelLoop | null> => {
      const res = await api.v1.loops[":loopId"].$get({ param: { loopId } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error("Failed to fetch the loop")
      return (await res.json()).loop
    },
  })
  return {
    loop: query.isPending ? undefined : (query.data ?? null),
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}

// The Loops an agent runs, in every chat this person can see and in none
// (reference/agents-and-chats.md §9). Loop events reach only the chats this
// client is in, so the list is read again each time it is shown.
export function useAgentLoops(workspaceSlug: string, agentId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ["agent-loops"] })
    socket.on("loop:updated", refresh)
    socket.on("loop:deleted", refresh)
    return () => {
      socket.off("loop:updated", refresh)
      socket.off("loop:deleted", refresh)
    }
  }, [socket, queryClient])
  return useQuery({
    queryKey: agentLoopsKey(agentId),
    enabled: Boolean(workspaceSlug && agentId),
    refetchOnMount: "always",
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].loops.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Failed to fetch the agent's loops")
      return (await res.json()).loops
    },
  })
}

// Hands a Loop to another agent, or moves where it reports (a chat, a
// Discord channel, or none).
export function useSetLoopPlace(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      place: { agentId: string } | { channelId: string | null }
    ) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await api.v1.loops[":loopId"].$patch({
        param: { loopId: loop.id },
        json: place,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          (body && "message" in body && body.message) ||
            "Failed to change the loop"
        )
      }
      return (await res.json()).loop
    },
    onSuccess: (updated) => replaceLoop(queryClient, updated),
    onError: (err) => {
      Alert.alert(
        "Couldn't change the loop",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
    onSettled: () => refetchLoops(queryClient, loop),
  })
}

type LoopLifecycleAction = "pause" | "resume" | "complete"

const STATUS_AFTER: Record<LoopLifecycleAction, ChannelLoop["status"]> = {
  pause: "paused",
  resume: "active",
  complete: "completed",
}

// Pause, resume and complete show at once; a refusal puts the loop back and
// says why. Mirrors web's useLoopLifecycle.
export function useLoopLifecycle(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: LoopLifecycleAction) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const client = api.v1.loops[":loopId"]
      const param = { loopId: loop.id }
      const res =
        action === "pause"
          ? await client.pause.$post({ param })
          : action === "resume"
            ? await client.resume.$post({ param })
            : await client.complete.$post({ param })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `Failed to ${action} the loop`)
      }
      return (await res.json()).loop
    },
    onMutate: (action) => {
      if (!loop) return undefined
      replaceLoop(queryClient, { ...loop, status: STATUS_AFTER[action] })
      return { previous: loop }
    },
    onSuccess: (updated) => replaceLoop(queryClient, updated),
    onError: (err, _action, context) => {
      if (context?.previous) replaceLoop(queryClient, context.previous)
      Alert.alert(
        "Couldn't change the loop",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
    onSettled: () => refetchLoops(queryClient, loop),
  })
}

// A run outside the schedule, which stays as it was. The server allows one
// run at a time. Mirrors web's useRunLoopNow.
export function useRunLoopNow(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!loop) throw new Error("Loop not loaded yet")
      const res = await api.v1.loops[":loopId"]["run-now"].$post({
        param: { loopId: loop.id },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to start the run")
      }
      return (await res.json()).loop
    },
    onSuccess: (updated) => {
      replaceLoop(queryClient, updated)
      void queryClient.invalidateQueries({
        queryKey: ["loop-runs", updated.id],
      })
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't start the run",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
    onSettled: () => refetchLoops(queryClient, loop),
  })
}

// Removes the loop and its card from the channel for good; it leaves the
// list at once and comes back if the server refuses. Mirrors web's
// useDeleteLoop.
export function useDeleteLoop(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!loop) throw new Error("Loop not loaded yet")
      const param = { loopId: loop.id }
      // A draft goes through discard-draft, which refuses (409) a loop
      // someone activated since this screen loaded.
      const res =
        loop.status === "draft"
          ? await api.v1.loops[":loopId"]["discard-draft"].$post({ param })
          : await api.v1.loops[":loopId"].$delete({ param })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to delete the loop")
      }
      return res.json()
    },
    onMutate: () => {
      if (!loop) return undefined
      const key = ["channel-loops", loop.channelId]
      queryClient.setQueryData(key, (existing: ChannelLoop[] | undefined) =>
        existing?.filter((item) => item.id !== loop.id)
      )
      // The agents' Loop lists it was in, so a failed delete puts it back.
      const agentKeys = queryClient
        .getQueriesData<ChannelLoop[]>({ queryKey: ["agent-loops"] })
        .filter(([, list]) => list?.some((item) => item.id === loop.id))
        .map(([agentKey]) => agentKey)
      queryClient.setQueriesData<ChannelLoop[]>(
        { queryKey: ["agent-loops"] },
        (existing) => existing?.filter((item) => item.id !== loop.id)
      )
      return { key, agentKeys, deleted: loop }
    },
    onSuccess: () => {
      if (!loop) return
      queryClient.removeQueries({ queryKey: ["loop-runs", loop.id] })
      queryClient.setQueryData(loopKey(loop.id), null)
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context) void queryClient.invalidateQueries({ queryKey: context.key })
      void queryClient.invalidateQueries({ queryKey: ["agent-loops"] })
    },
    onError: (err, _vars, context) => {
      // Only the deleted loop comes back; updates to others since stay.
      if (context) {
        const restore = (existing: ChannelLoop[] | undefined) =>
          existing && !existing.some((item) => item.id === context.deleted.id)
            ? [context.deleted, ...existing]
            : existing
        queryClient.setQueryData(context.key, restore)
        for (const agentKey of context.agentKeys) {
          queryClient.setQueryData(agentKey, restore)
        }
      }
      Alert.alert(
        "Couldn't delete the loop",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
  })
}

// Web's order: what runs first, then paused, drafts, and finished loops.
const STATUS_ORDER: Record<ChannelLoop["status"], number> = {
  active: 0,
  paused: 1,
  draft: 2,
  completed: 3,
}

export function sortLoops(loops: ChannelLoop[]): ChannelLoop[] {
  return [...loops].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.createdAt.localeCompare(a.createdAt)
  )
}
