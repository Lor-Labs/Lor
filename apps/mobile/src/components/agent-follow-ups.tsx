import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useThemeColor } from "heroui-native/hooks"
import { useToast } from "heroui-native/toast"
import { useEffect, useMemo } from "react"
import { Pressable, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { SectionLabel } from "@/components/ui/section-label"
import { useSocket } from "@/context/socket-context"
import { useChannelRoom } from "@/hooks/use-channel-room"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api, responseMessage } from "@/lib/api"
import { toSearchPreviewText } from "@/lib/message-markdown"

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

const MENTION_TOKEN = /<@([0-9a-f-]{36})>/gi

// The follow-ups the channel agent set for itself with wake_up
// (reference/always-on-agents.md, decision 10): when it will look again and
// why. Anyone here can cancel one. Kept live by agent:wake-ups:updated. As
// web's follow-ups-section.tsx; shows nothing when it has none.
export function AgentFollowUps({
  workspaceSlug,
  channelId,
  agentName,
}: {
  workspaceSlug: string
  channelId: string
  agentName: string
}) {
  const muted = useThemeColor("muted")
  const { toast } = useToast()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { members } = useWorkspaceMembers(workspaceSlug)
  const nameById = useMemo(
    () => new Map(members.map((member) => [member.userId, member.name])),
    [members]
  )
  // agent:wake-ups:updated reaches the channel room, which the channel
  // screen leaves when this screen replaces it; held here (refcounted).
  useChannelRoom(socket, channelId)
  const { data, isError, isRefetching, refetch } = useQuery({
    queryKey: wakeUpsKey(channelId),
    queryFn: async (): Promise<WakeUp[]> => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-wake-ups"].$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Couldn't load follow-ups")
      return (await res.json()).wakeUps
    },
  })

  useEffect(() => {
    if (!socket) return
    const onUpdated: ServerToClientEvents["agent:wake-ups:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({ queryKey: wakeUpsKey(channelId) })
    }
    socket.on("agent:wake-ups:updated", onUpdated)
    return () => {
      socket.off("agent:wake-ups:updated", onUpdated)
    }
  }, [socket, queryClient, channelId])

  const cancel = useMutation({
    mutationFn: async (wakeUpId: string) => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-wake-ups"][":wakeUpId"].$delete({
        param: { workspaceSlug, channelId, wakeUpId },
      })
      if (!res.ok) {
        throw new Error(
          await responseMessage(res, "Couldn't cancel the follow-up")
        )
      }
      return wakeUpId
    },
    // An in-flight read would bring the cancelled follow-up back.
    onSuccess: async (wakeUpId) => {
      await queryClient.cancelQueries({ queryKey: wakeUpsKey(channelId) })
      queryClient.setQueryData<WakeUp[]>(wakeUpsKey(channelId), (list) =>
        list?.filter((wakeUp) => wakeUp.id !== wakeUpId)
      )
      void queryClient.invalidateQueries({ queryKey: wakeUpsKey(channelId) })
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: "Follow-up not cancelled",
        description: error.message,
      }),
  })

  const wakeUps = data ?? []
  // A failed load isn't "none": say so, with a way to try again.
  if (isError && data === undefined) {
    return (
      <View className="gap-two">
        <SectionLabel>Follow-ups</SectionLabel>
        <Pressable
          accessibilityRole="button"
          className="rounded-lor-lg bg-surface-secondary px-three py-three active:opacity-70"
          disabled={isRefetching}
          onPress={() => void refetch()}
        >
          <Text className="text-sm text-muted">
            Couldn't load the follow-ups.{" "}
            <Text className="font-semibold text-foreground">
              {isRefetching ? "Trying again…" : "Try again"}
            </Text>
          </Text>
        </Pressable>
      </View>
    )
  }
  if (wakeUps.length === 0) return null
  // The agent writes people as mention tokens in its notes.
  const readable = (note: string) =>
    toSearchPreviewText(
      note.replace(MENTION_TOKEN, (_token, id: string) => {
        const name = nameById.get(id)
        return name ? `@${name}` : ""
      }),
      []
    )
  return (
    <View className="gap-two">
      <SectionLabel>{`Follow-ups · ${wakeUps.length}`}</SectionLabel>
      <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
        {wakeUps.map((wakeUp, index) => (
          <View key={wakeUp.id}>
            {index > 0 ? (
              <View className="ml-[44px] h-px bg-separator" />
            ) : null}
            <View className="flex-row items-start gap-three py-two pl-three pr-one">
              <View className="pt-[3px]">
                <HugeiconsIcon color={muted} icon={Clock01Icon} size={17} />
              </View>
              <View className="min-w-0 flex-1 gap-px">
                <Text className="text-[15px] leading-5 text-foreground">
                  {agentName} checks back {formatDue(wakeUp.dueAt)}
                </Text>
                <Text
                  className="text-xs leading-4 text-muted"
                  numberOfLines={3}
                >
                  {readable(wakeUp.note)}
                </Text>
              </View>
              <IconButton
                accessibilityLabel="Cancel follow-up"
                isDisabled={cancel.isPending}
                onPress={() => cancel.mutate(wakeUp.id)}
                variant="ghost"
              >
                <HugeiconsIcon color={muted} icon={Cancel01Icon} size={16} />
              </IconButton>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
