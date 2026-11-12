import ArrowTurnBackwardIcon from "@hugeicons/core-free-icons/ArrowTurnBackwardIcon"
import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import * as Clipboard from "expo-clipboard"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useContext, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableScale } from "@/components/ui/pressable-scale"
import { RunModelLabelContext } from "@/hooks/use-agent-models"
import type { Message } from "@/lib/api-types"
import { SCROLL_PRESS_DELAY_MS } from "@/lib/motion"

const COPIED_MS = 1500

// The row under Lor's finished replies in a session, as on web and in
// ChatGPT and Claude: the things people do with an answer are one tap away
// instead of behind a long-press. Then the model the reply ran on and when
// (tap the model for its exact name). The long-press menu still has
// everything, reactions included; "More" opens it.
export function LorReplyActions({
  message,
  onReply,
  onForward,
  onFork,
  forking = false,
  onMore,
}: {
  message: Message
  // Unset where nothing can be sent (an archived session).
  onReply?: () => void
  onForward?: () => void
  // The caller asks first: a fork makes a new session.
  onFork?: () => void
  // The fork is being made; its button spins.
  forking?: boolean
  onMore: () => void
}) {
  const muted = useThemeColor("muted")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const model = message.lorRun?.model
  const labelFor = useContext(RunModelLabelContext)
  const label = model && labelFor ? labelFor(model) : null
  const [exact, setExact] = useState(false)
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    // The buttons' own padding is the gap above; pulled left so the first
    // icon lines up with the reply's text.
    <View className="-ml-[7px] mt-one flex-row items-center">
      {message.content ? (
        <RowAction
          color={muted}
          icon={copied ? Tick02Icon : Copy01Icon}
          label={copied ? "Copied" : "Copy"}
          onPress={() => {
            void Clipboard.setStringAsync(message.content ?? "")
              .then(() => {
                triggerHaptic("light")
                setCopied(true)
              })
              .catch(() => undefined)
          }}
        />
      ) : null}
      {onReply ? (
        <RowAction
          color={muted}
          icon={ArrowTurnBackwardIcon}
          label="Reply"
          onPress={onReply}
        />
      ) : null}
      {onForward ? (
        <RowAction
          color={muted}
          icon={ArrowTurnForwardIcon}
          label="Forward to chat"
          onPress={onForward}
        />
      ) : null}
      {onFork ? (
        forking ? (
          <View
            accessibilityLabel="Forking"
            className="size-8 items-center justify-center"
          >
            <Spinner color="default" size="sm" />
          </View>
        ) : (
          <RowAction
            color={muted}
            icon={GitForkIcon}
            label="Fork from here"
            onPress={onFork}
          />
        )
      ) : null}
      <RowAction
        color={muted}
        icon={MoreHorizontalIcon}
        label="More actions"
        onPress={onMore}
      />
      <Text
        accessibilityHint={label?.exact ? "Shows the exact model" : undefined}
        className="ml-two min-w-0 shrink text-xs text-muted"
        numberOfLines={1}
        onPress={label?.exact ? () => setExact((shown) => !shown) : undefined}
        style={{ fontVariant: ["tabular-nums"] }}
        suppressHighlighting
      >
        {label
          ? `${exact && label.exact ? label.exact : label.name} · ${time}`
          : time}
      </Text>
    </View>
  )
}

function RowAction({
  color,
  icon,
  label,
  onPress,
}: {
  color: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      className="size-8 items-center justify-center"
      // 32pt drawn, 44pt touchable.
      hitSlop={6}
      onPress={onPress}
      scale={0.88}
      // In the transcript: a scroll that starts on it doesn't press it.
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
    >
      <HugeiconsIcon color={color} icon={icon} size={17} strokeWidth={1.7} />
    </PressableScale>
  )
}
