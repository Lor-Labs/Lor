import ArrowMoveDownRightIcon from "@hugeicons/core-free-icons/ArrowMoveDownRightIcon"
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { messageDisplayName } from "@/components/message-row"
import { Avatar } from "@/components/ui/avatar"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/message-markdown"
import { isOptimisticMessage } from "@/lib/messages"

// Messages waiting while Lor works: each waits for the current answer unless
// steered, which hands it to the active run at its next step. In a thread, a
// Codex-style card tucked behind the composer's input card (rendered via its
// topAccessory slot; the negative bottom margin slides it under the opaque
// card's rounded top edge). In a session document, waiting turns at the end
// of the transcript: faded, with the writer in the gutter.
export function RunQueuePill({
  messages,
  currentUserId,
  variant = "box",
}: {
  messages: Message[]
  currentUserId: string | undefined
  variant?: "box" | "document"
}) {
  if (messages.length === 0) return null
  if (variant === "document") {
    return (
      <View className="gap-one pb-two pt-three">
        {messages.map((message) => (
          <QueuedTurn
            key={message.id}
            isOwn={message.authorId === currentUserId}
            message={message}
          />
        ))}
      </View>
    )
  }
  return (
    <View className="-mb-[10px] mx-three overflow-hidden rounded-t-lor-sm border border-border bg-surface-secondary pb-[10px]">
      {messages.map((message, index) => (
        <QueueRow
          key={message.id}
          isLast={index === messages.length - 1}
          isOwn={message.authorId === currentUserId}
          message={message}
        />
      ))}
    </View>
  )
}

function useQueueActions(message: Message) {
  const socket = useSocket()
  const { toast } = useToast()
  const [pending, setPending] = useState<"steer" | "remove" | null>(null)
  // A just-sent row still carries its optimistic nonce id — the server
  // doesn't know it yet, so hold the actions until the created echo swaps in
  // the real id (milliseconds later).
  const disabled = pending !== null || isOptimisticMessage(message)

  const steer = async () => {
    setPending("steer")
    try {
      const res = await api.v1.runs["queued-messages"][
        ":messageId"
      ].steer.$post({ param: { messageId: message.id } })
      if (!res.ok) throw new Error()
    } catch {
      toast.show({ variant: "danger", label: "Couldn't steer this message" })
    } finally {
      setPending(null)
    }
  }

  const remove = async () => {
    // Deleting needs the socket — withdrawing the queue row without the
    // delete would post the message instead of removing it.
    if (!socket) {
      toast.show({ variant: "danger", label: "Connection lost — try again" })
      return
    }
    setPending("remove")
    try {
      // Withdraw the queue row first (needs the message to still exist),
      // then delete the message itself — a queued message was never visible
      // in the transcript, so removing it means it was never sent.
      const res = await api.v1.runs["queued-messages"][":messageId"].$delete({
        param: { messageId: message.id },
      })
      if (!res.ok) throw new Error()
      socket.emit(
        "message:delete",
        { channelId: message.channelId, messageId: message.id },
        (result) => {
          if (!result.ok) {
            toast.show({
              variant: "danger",
              label: "Couldn't delete the queued message",
            })
          }
        }
      )
    } catch {
      toast.show({ variant: "danger", label: "Couldn't remove this message" })
    } finally {
      setPending(null)
    }
  }

  return { pending, disabled, steer, remove }
}

function QueueRow({
  message,
  isOwn,
  isLast,
}: {
  message: Message
  isOwn: boolean
  isLast: boolean
}) {
  const muted = useThemeColor("muted")
  const { pending, disabled, steer, remove } = useQueueActions(message)

  return (
    <View
      className={`flex-row items-center gap-two px-two py-[7px] ${
        isLast ? "" : "border-b border-border"
      }`}
    >
      <HugeiconsIcon color={muted} icon={ArrowMoveDownRightIcon} size={13} />
      {isOwn ? null : (
        <Text className="text-[13px] font-medium text-muted">
          {messageDisplayName(message)}
        </Text>
      )}
      <Text
        className="min-w-0 flex-1 text-[13px] text-foreground"
        numberOfLines={1}
      >
        {message.content}
      </Text>
      {pending === "steer" ? (
        <Text className="text-xs italic text-muted">Steering…</Text>
      ) : (
        <Pressable
          accessibilityLabel="Steer this message"
          className={`min-h-7 flex-row items-center gap-one rounded-lor-sm px-two active:bg-accent-soft ${
            disabled ? "opacity-40" : ""
          }`}
          disabled={disabled}
          hitSlop={6}
          onPress={() => void steer()}
        >
          <HugeiconsIcon
            color={muted}
            icon={ArrowMoveDownRightIcon}
            size={12}
          />
          <Text className="text-xs font-medium text-muted">Steer</Text>
        </Pressable>
      )}
      {isOwn ? (
        <Pressable
          accessibilityLabel="Remove from queue"
          className={`min-h-7 items-center justify-center rounded-lor-sm px-one active:bg-accent-soft ${
            disabled ? "opacity-40" : ""
          }`}
          disabled={disabled}
          hitSlop={6}
          onPress={() => void remove()}
        >
          <HugeiconsIcon color={muted} icon={Delete02Icon} size={13} />
        </Pressable>
      ) : null}
    </View>
  )
}

// A waiting message in a session: reads as the next turn of the document,
// faded until Lor takes it. Mirrors web's QueuedTurn.
function QueuedTurn({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const muted = useThemeColor("muted")
  const { pending, disabled, steer, remove } = useQueueActions(message)
  const name = messageDisplayName(message)
  const action = `text-xs font-medium text-muted ${disabled ? "opacity-50" : ""}`

  return (
    <View className="flex-row gap-three px-four">
      <View className="w-7 pt-px opacity-60">
        <Avatar
          avatarColor={message.author.avatarColor}
          className="size-7"
          image={message.author.image}
          name={name}
          size="xs"
        />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base leading-6 text-muted" numberOfLines={3}>
          {toSearchPreviewText(message.content, message.mentions)}
        </Text>
        <View className="mt-px min-h-7 flex-row flex-wrap items-center gap-x-two">
          <View className="flex-row items-center gap-one">
            <HugeiconsIcon color={muted} icon={Clock01Icon} size={12} />
            <Text className="text-xs text-muted">
              {pending === "steer"
                ? "Steering…"
                : isOwn
                  ? "Queued for Lor"
                  : `Queued by ${name}`}
            </Text>
          </View>
          {pending === "steer" ? null : (
            <>
              <Text className="text-xs text-muted">·</Text>
              <Pressable
                accessibilityHint="Lor reads it at its next step instead of after this reply"
                accessibilityLabel="Steer now"
                accessibilityRole="button"
                disabled={disabled}
                hitSlop={8}
                onPress={() => void steer()}
              >
                <Text className={action}>Steer now</Text>
              </Pressable>
            </>
          )}
          {isOwn ? (
            <>
              <Text className="text-xs text-muted">·</Text>
              <Pressable
                accessibilityLabel="Remove from queue"
                accessibilityRole="button"
                disabled={disabled}
                hitSlop={8}
                onPress={() => void remove()}
              >
                <Text className={action}>Remove</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </View>
  )
}
