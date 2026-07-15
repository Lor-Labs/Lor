import AtSignIcon from "@hugeicons/core-free-icons/AtSignIcon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import LaughingIcon from "@hugeicons/core-free-icons/LaughingIcon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import SentIcon from "@hugeicons/core-free-icons/SentIcon"
import TextFontIcon from "@hugeicons/core-free-icons/TextFontIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { Alert } from "heroui-native/alert"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { TextArea } from "heroui-native/text-area"
import { useState } from "react"
import { View } from "react-native"
import Animated, { LinearTransition } from "react-native-reanimated"
import { IconButton } from "@/components/ui/icon-button"

const composerLayoutTransition = LinearTransition.duration(100)

export function MessageComposer({
  channelName,
  isSending,
  isConnected,
  onSend,
}: {
  channelName: string
  isSending: boolean
  isConnected: boolean
  onSend: (content: string) => Promise<void>
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [content, setContent] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const hasMessage = content.trim().length > 0
  const canSend = hasMessage && !isSending && isConnected
  const isExpanded = isFocused || content.length > 0

  const send = async () => {
    if (!canSend) return
    const next = content
    setContent("")
    try {
      await onSend(next)
    } catch {
      setContent(next)
    }
  }

  return (
    <View className="bg-background px-three pb-three pt-two">
      {!isConnected ? (
        <Alert
          className="mb-two rounded-lor-sm bg-warning-soft p-two shadow-none"
          status="warning"
        >
          <Alert.Indicator className="pt-px" iconProps={{ size: 16 }} />
          <Alert.Content>
            <Alert.Title className="text-sm">Reconnecting…</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      <Animated.View
        className="relative overflow-hidden rounded-lor-sm border border-border bg-surface"
        layout={composerLayoutTransition}
      >
        <TextArea
          accessibilityLabel={`Message ${channelName}`}
          className={`h-auto max-h-[120px] border-transparent bg-transparent px-four text-base leading-[21px] shadow-none ios:shadow-none ios:outline-transparent ios:focus:outline-transparent android:border-transparent android:focus:border-transparent ${
            isExpanded
              ? "min-h-[56px] pb-two pt-three"
              : "min-h-12 py-three pl-[52px] pr-[60px]"
          }`}
          isDisabled={!isConnected || isSending}
          onBlur={() => setIsFocused(false)}
          onChangeText={setContent}
          onFocus={() => setIsFocused(true)}
          onSubmitEditing={() => void send()}
          placeholder={`Message #${channelName}`}
          returnKeyType={hasMessage ? "send" : "default"}
          submitBehavior={hasMessage ? "submit" : "newline"}
          value={content}
        />
        {isExpanded ? (
          <View className="min-h-10 flex-row items-center gap-one px-two pb-two">
            <ComposerShortcut color={muted} emphasized icon={PlusSignIcon} />
            <ComposerShortcut color={muted} icon={TextFontIcon} />
            <ComposerShortcut color={muted} icon={LaughingIcon} />
            <ComposerShortcut color={muted} icon={AtSignIcon} />
            <ComposerShortcut color={muted} icon={CommandLineIcon} />
            <ComposerSendButton
              accent={accent}
              canSend={canSend}
              className="ml-auto"
              isSending={isSending}
              muted={muted}
              onPress={() => void send()}
            />
          </View>
        ) : (
          <>
            <View className="absolute bottom-two left-two">
              <ComposerShortcut color={muted} emphasized icon={PlusSignIcon} />
            </View>
            <ComposerSendButton
              accent={accent}
              canSend={canSend}
              className="absolute bottom-one right-one"
              isSending={isSending}
              muted={muted}
              onPress={() => void send()}
            />
          </>
        )}
      </Animated.View>
    </View>
  )
}

function ComposerShortcut({
  color,
  emphasized = false,
  icon,
}: {
  color: string
  emphasized?: boolean
  icon: IconSvgElement
}) {
  return (
    <View
      accessibilityElementsHidden
      className={`size-8 items-center justify-center rounded-lor-sm ${
        emphasized ? "bg-default" : ""
      }`}
      importantForAccessibility="no-hide-descendants"
    >
      <HugeiconsIcon color={color} icon={icon} size={18} />
    </View>
  )
}

function ComposerSendButton({
  accent,
  canSend,
  className,
  isSending,
  muted,
  onPress,
}: {
  accent: string
  canSend: boolean
  className?: string
  isSending: boolean
  muted: string
  onPress: () => void
}) {
  return (
    <IconButton
      accessibilityLabel="Send message"
      className={className}
      feedbackVariant="scale"
      isDisabled={!canSend}
      onPress={onPress}
      variant="ghost"
    >
      {isSending ? (
        <Spinner color={accent} size="sm" />
      ) : (
        <HugeiconsIcon
          color={canSend ? accent : muted}
          icon={SentIcon}
          size={16}
        />
      )}
    </IconButton>
  )
}
