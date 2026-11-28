import type { InferResponseType } from "@repo/api-client"
import type { RealtimeLoop, ServerToClientEvents } from "@repo/realtime-types"
import {
  type QueryClient,
  type QueryKey,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelLoop = RealtimeLoop

export type LoopRun = InferResponseType<
  (typeof apiClient.v1.loops)[":loopId"]["runs"]["$get"],
  200
>["runs"][number]

// A Loop is cached in three places: the list of each chat it shows in (the
// chat it reports in, and the chat its card is in), the list of the agent it
// belongs to, and on its own when its panel is open beside another chat.
const CHAT_LOOPS = "channel-loops"
const AGENT_LOOPS = "agent-loops"
const ONE_LOOP = "loop"
const LOOP_LISTS = [[CHAT_LOOPS], [AGENT_LOOPS]] as const

export const agentLoopsKey = (agentId: string) =>
  [AGENT_LOOPS, agentId] as const
const loopKey = (loopId: string) => [ONE_LOOP, loopId] as const

export type LoopSnapshot = [QueryKey, unknown][]

// Changes a Loop in every cached copy before the server answers; null
// removes it. The snapshot puts everything back if the server refuses.
export async function patchLoop(
  queryClient: QueryClient,
  loopId: string,
  update: (loop: ChannelLoop) => ChannelLoop | null
): Promise<LoopSnapshot> {
  const snapshot: LoopSnapshot = []
  for (const queryKey of LOOP_LISTS) {
    await queryClient.cancelQueries({ queryKey })
    snapshot.push(...queryClient.getQueriesData<ChannelLoop[]>({ queryKey }))
    queryClient.setQueriesData<ChannelLoop[]>({ queryKey }, (loops) =>
      loops?.flatMap((loop) =>
        loop.id === loopId ? (update(loop) ?? []) : loop
      )
    )
  }
  await queryClient.cancelQueries({ queryKey: loopKey(loopId) })
  snapshot.push([loopKey(loopId), queryClient.getQueryData(loopKey(loopId))])
  queryClient.setQueryData<ChannelLoop | null>(loopKey(loopId), (loop) =>
    loop ? update(loop) : loop
  )
  // cancelQueries reverts a first fetch to pending with nothing in flight;
  // read those again so they don't stay loading (loop:deleted, optimistic edits).
  for (const queryKey of [...LOOP_LISTS, loopKey(loopId)]) {
    void queryClient.invalidateQueries({
      queryKey,
      predicate: (query) => query.state.data === undefined,
    })
  }
  return snapshot
}

export function restoreLoops(
  queryClient: QueryClient,
  snapshot: LoopSnapshot | undefined
) {
  for (const [queryKey, data] of snapshot ?? []) {
    queryClient.setQueryData(queryKey, data)
  }
}

// The server's copy of a Loop, written over every cached one. A list it is
// not in yet is read again, since only the server knows whether it belongs
// there (a Loop moved to another chat, or handed to another agent).
export function writeLoop(queryClient: QueryClient, loop: ChannelLoop) {
  queryClient.setQueryData(loopKey(loop.id), loop)
  for (const queryKey of LOOP_LISTS) {
    queryClient.setQueriesData<ChannelLoop[]>({ queryKey }, (loops) =>
      loops?.map((item) => (item.id === loop.id ? loop : item))
    )
  }
  const missingFrom = (queryKey: QueryKey) => {
    const loops = queryClient.getQueryData<ChannelLoop[]>(queryKey)
    return loops !== undefined && !loops.some((item) => item.id === loop.id)
  }
  for (const queryKey of [
    ...(loop.channelId ? [[CHAT_LOOPS, loop.channelId]] : []),
    ...(loop.agentId ? [agentLoopsKey(loop.agentId)] : []),
  ]) {
    if (missingFrom(queryKey)) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}

export function channelLoopsQueryOptions(channelId: string) {
  return {
    queryKey: [CHAT_LOOPS, channelId] as const,
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await apiClient.v1.channels[":channelId"].loops.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch the chat's loops")
      const payload = await res.json()
      return payload.loops
    },
  }
}

// The Loops an agent runs, in every chat this person can see and in none
// (reference/agents-and-chats.md §9: a Loop belongs to its agent). Loop
// events reach only the chats this client is in, so the list is also read
// again each time it is shown.
export function useAgentLoops(workspaceSlug: string, agentId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: agentLoopsKey(agentId),
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].loops.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Failed to fetch the agent's loops")
      return (await res.json()).loops
    },
    refetchOnMount: "always",
  })

  useEffect(() => {
    if (!socket) return
    // A Loop handed to another agent changes two lists, so every agent's
    // list is read again.
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: [AGENT_LOOPS] })
    socket.on("loop:updated", refresh)
    socket.on("loop:deleted", refresh)
    return () => {
      socket.off("loop:updated", refresh)
      socket.off("loop:deleted", refresh)
    }
  }, [socket, queryClient])

  return query
}

// A chat's loop list, kept live by loop:updated — mirrors useChannelPlans.
// One query per chat feeds every loop card. It holds the Loops that report
// in the chat and those whose card is in it; `inChat` narrows to the first.
export function useChannelLoops(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelLoopsQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const handleLoopUpdated: ServerToClientEvents["loop:updated"] = (
      payload
    ) => {
      const here =
        payload.loop.channelId === channelId ||
        payload.cardChannelId === channelId
      queryClient.setQueryData(
        [CHAT_LOOPS, channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== payload.loop.id)
          // One that left this chat stays only while its card is here.
          return here ? [payload.loop, ...rest] : rest
        }
      )
      queryClient.setQueryData<ChannelLoop | null>(
        loopKey(payload.loop.id),
        (existing) => (existing === undefined ? existing : payload.loop)
      )
      // A status/lastRun flip usually means a run started or settled —
      // refresh the history lazily (only refetches while the panel shows it).
      queryClient.invalidateQueries({
        queryKey: ["loop-runs", payload.loop.id],
      })
    }
    const handleLoopDeleted: ServerToClientEvents["loop:deleted"] = (
      payload
    ) => {
      void patchLoop(queryClient, payload.loopId, () => null)
      queryClient.removeQueries({ queryKey: ["loop-runs", payload.loopId] })
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

// The Loops that report in a chat, out of its list (which also holds the
// ones that only have their card there).
export const inChat = (loops: ChannelLoop[] | undefined, channelId: string) =>
  loops?.filter((loop) => loop.channelId === channelId)

export function useLoopForCard(
  channelId: string,
  cardMessageId: string
): ChannelLoop | null {
  const { data } = useChannelLoops(channelId)
  return data?.find((l) => l.cardMessageId === cardMessageId) ?? null
}

// One Loop, for its panel. The panel opens beside a chat: when the Loop is
// in that chat's list it is read from there, else (a Loop with no chat, or
// one in another chat) by id. `loop` is undefined while loading and null when
// gone (404); a failed read (5xx, network) is `failed`, not gone.
export function useLoop(
  loopId: string,
  besideChannelId: string
): {
  loop: ChannelLoop | null | undefined
  failed: boolean
  retry: () => void
} {
  const list = useChannelLoops(besideChannelId)
  const listed = list.data?.find((loop) => loop.id === loopId)
  const single = useQuery({
    queryKey: loopKey(loopId),
    enabled: !list.isPending && !listed,
    queryFn: async (): Promise<ChannelLoop | null> => {
      const res = await apiClient.v1.loops[":loopId"].$get({
        param: { loopId },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error("Failed to fetch the loop")
      return (await res.json()).loop
    },
  })
  const retry = () => void single.refetch()
  if (listed) return { loop: listed, failed: false, retry }
  if (list.isPending || single.isPending) {
    return { loop: undefined, failed: false, retry }
  }
  if (single.isError && single.data === undefined) {
    return { loop: undefined, failed: true, retry }
  }
  return { loop: single.data ?? null, failed: false, retry }
}

// Run history for the loop detail panel, newest scheduled fire first.
// The loop's recent runs, plus its session (where each run answered).
export function useLoopRuns(loopId: string | null) {
  return useQuery({
    queryKey: ["loop-runs", loopId ?? ""],
    enabled: loopId !== null,
    queryFn: async (): Promise<{
      sessionId: string | null
      runs: LoopRun[]
    }> => {
      const res = await apiClient.v1.loops[":loopId"].runs.$get({
        param: { loopId: loopId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch loop runs")
      return res.json()
    },
  })
}
