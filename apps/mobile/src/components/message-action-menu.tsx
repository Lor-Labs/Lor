import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon"
import MessageCircleReplyIcon from "@hugeicons/core-free-icons/MessageCircleReplyIcon"
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon"
import ThreadIcon from "@hugeicons/core-free-icons/ThreadIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import * as Clipboard from "expo-clipboard"
import { useThemeColor } from "heroui-native/hooks"
import { Menu } from "heroui-native/menu"
import type { ReactNode } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { triggerHaptic } from "@/components/ui/haptics"
import { LorMark } from "@/components/voice/lor-window"
import type { Message } from "@/lib/api-types"

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🎉", "👀", "🔥"] as const

export function MessageActionMenu({
  message,
  onOpenChange,
  onReply,
  onOpenThread,
  onAskLor,
  onEdit,
  onDelete,
  onToggleReaction,
  onTogglePin,
}: {
  message: Message | null
  onOpenChange: (isOpen: boolean) => void
  // Unset where nothing can be sent (an archived session).
  onReply?: () => void
  onOpenThread?: () => void
  // Channel chat: start a session about this message.
  onAskLor?: () => void
  onEdit?: (message: Message) => void
  onDelete?: (message: Message) => void
  onToggleReaction?: (message: Message, emoji: string) => void
  onTogglePin?: (message: Message) => void
}) {
  const [foreground, accent, danger] = useThemeColor([
    "foreground",
    "accent",
    "danger",
  ])
  const threadActionLabel = message?.threadSummary
    ? "Open thread"
    : "Reply in thread"

  return (
    <Menu
      isOpen={message !== null}
      onOpenChange={onOpenChange}
      presentation="bottom-sheet"
    >
      <Menu.Portal unstable_accessibilityContainerViewIsModal>
        <Menu.Overlay className="bg-neutral-950/50" />
        <Menu.Content
          contentContainerClassName="gap-four px-four pb-six pt-two"
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="none"
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return

            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          presentation="bottom-sheet"
          snapPoints={["54%", "92%"]}
        >
          {message && onToggleReaction ? (
            <ScrollView
              contentContainerClassName="gap-two"
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {QUICK_REACTIONS.map((emoji) => {
                const isSelected = message.reactions.some(
                  (reaction) =>
                    reaction.emoji === emoji && reaction.reactedByCurrentUser
                )

                return (
                  <Pressable
                    accessibilityLabel={`React with ${emoji}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    className={`size-14 items-center justify-center rounded-lor-lg border ${
                      isSelected
                        ? "border-accent bg-accent-soft"
                        : "border-transparent bg-surface-secondary"
                    }`}
                    key={emoji}
                    onPress={() => {
                      onToggleReaction(message, emoji)
                      onOpenChange(false)
                    }}
                  >
                    <Text className="text-[26px] leading-8">{emoji}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}

          {onReply || onOpenThread || onAskLor ? (
            <View className="flex-row gap-three">
              {onReply ? (
                <ActionTile
                  icon={MessageCircleReplyIcon}
                  label="Reply"
                  onPress={onReply}
                  tint={foreground}
                />
              ) : null}
              {onOpenThread ? (
                <ActionTile
                  icon={ThreadIcon}
                  label={threadActionLabel}
                  onPress={onOpenThread}
                  tint={accent}
                />
              ) : null}
              {onAskLor ? (
                <ActionTile
                  accessibilityLabel="Ask Lor about this"
                  // The mark is wide; 28 wide sits level with 25px icons.
                  glyph={<LorMark size={28} />}
                  label="Ask Lor"
                  onPress={onAskLor}
                />
              ) : null}
            </View>
          ) : null}

          {message?.content || (message && (onEdit || onTogglePin)) ? (
            <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
              {message.content ? (
                <ActionRow
                  icon={Copy01Icon}
                  label="Copy text"
                  onPress={() => {
                    void Clipboard.setStringAsync(message.content ?? "")
                      .then(() => onOpenChange(false))
                      .catch(() => undefined)
                  }}
                  tint={foreground}
                />
              ) : null}
              {message.content && (onEdit || onTogglePin) ? (
                <View className="ml-14 h-px bg-separator" />
              ) : null}
              {message.content && onEdit ? (
                <ActionRow
                  icon={Edit02Icon}
                  label="Edit message"
                  onPress={() => {
                    onOpenChange(false)
                    onEdit(message)
                  }}
                  tint={foreground}
                />
              ) : null}
              {message.content && onEdit && onTogglePin ? (
                <View className="ml-14 h-px bg-separator" />
              ) : null}
              {onTogglePin ? (
                <ActionRow
                  icon={message.pinned ? PinOffIcon : Pin02Icon}
                  label={message.pinned ? "Unpin message" : "Pin message"}
                  onPress={() => {
                    triggerHaptic("selection")
                    onTogglePin(message)
                    onOpenChange(false)
                  }}
                  tint={message.pinned ? accent : foreground}
                />
              ) : null}
            </View>
          ) : null}

          {message && onDelete ? (
            <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
              <ActionRow
                danger
                icon={Delete02Icon}
                label="Delete message"
                onPress={() => {
                  onOpenChange(false)
                  onDelete(message)
                }}
                tint={danger}
              />
            </View>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

function ActionRow({
  danger = false,
  icon,
  label,
  onPress,
  tint,
}: {
  danger?: boolean
  icon: IconSvgElement
  label: string
  onPress: () => void
  tint: string
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-three px-four py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon color={tint} icon={icon} size={21} strokeWidth={1.8} />
      <Text
        className={`flex-1 text-[15px] font-medium ${danger ? "text-danger" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function ActionTile({
  accessibilityLabel,
  glyph,
  icon,
  label,
  onPress,
  tint,
}: {
  accessibilityLabel?: string
  // Drawn instead of an icon (the Lor mark).
  glyph?: ReactNode
  icon?: IconSvgElement
  label: string
  onPress: () => void
  tint?: string
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      className="min-h-24 flex-1 items-center justify-center gap-two rounded-lor-lg bg-surface-secondary px-three py-four active:bg-surface-tertiary"
      onPress={onPress}
    >
      {glyph ??
        (icon ? (
          <HugeiconsIcon color={tint} icon={icon} size={25} strokeWidth={1.8} />
        ) : null)}
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  )
}
