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
      if (payload.loop.channelId !== channelId) return
      if (!queryClient.getQueryData(["channel-loops", channelId])) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-loops", channelId],
        })
      }
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== payload.loop.id)
          return [payload.loop, ...rest]
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
      queryClient.setQueryData(
        ["channel-loops", result.loop.channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== result.loop.id)
          return [result.loop, ...rest]
        }
      )
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

// Loops carry no version, so a response or rollback can be older than a
// loop:updated that landed meanwhile: each mutation refetches when it settles.
const refetchLoops = (queryClient: QueryClient, loop: ChannelLoop | null) => {
  if (!loop) return
  void queryClient.invalidateQueries({
    queryKey: ["channel-loops", loop.channelId],
  })
}

function replaceLoop(queryClient: QueryClient, updated: ChannelLoop) {
  queryClient.setQueryData(
    ["channel-loops", updated.channelId],
    (existing: ChannelLoop[] | undefined) =>
      existing?.map((loop) => (loop.id === updated.id ? updated : loop))
  )
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
      return { key, deleted: loop }
    },
    onSuccess: () => {
      if (loop) queryClient.removeQueries({ queryKey: ["loop-runs", loop.id] })
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context) void queryClient.invalidateQueries({ queryKey: context.key })
    },
    onError: (err, _vars, context) => {
      // Only the deleted loop comes back; updates to others since stay.
      if (context) {
        queryClient.setQueryData(
          context.key,
          (existing: ChannelLoop[] | undefined) =>
            existing && !existing.some((item) => item.id === context.deleted.id)
              ? [context.deleted, ...existing]
              : existing
        )
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
