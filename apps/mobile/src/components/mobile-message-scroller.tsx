import { KeyboardAwareLegendList } from "@legendapp/list/keyboard"
import type {
  LegendListProps,
  LegendListRef,
} from "@legendapp/list/react-native"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import {
  forwardRef,
  type RefAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { Keyboard, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
} from "react-native-reanimated"
import type { ChatMessageListKeyboardProps } from "@/components/chat-keyboard-layout"
import { Button } from "@/components/ui/button"

type MobileMessageScrollerProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  "inverted" | "refScrollView" | "renderScrollComponent" | "sharedValues"
> & {
  isMerlinResponding?: boolean
  keyboardProps: ChatMessageListKeyboardProps
  newestItemKey?: string | null
}

const CHAT_MAINTAIN_SCROLL_AT_END = { animated: false } as const
const CHAT_MAINTAIN_VISIBLE_CONTENT = { data: true } as const

function MobileMessageScrollerInner<ItemT>(
  {
    alignItemsAtEnd = true,
    isMerlinResponding = false,
    keyboardProps,
    maintainScrollAtEnd = CHAT_MAINTAIN_SCROLL_AT_END,
    maintainScrollAtEndThreshold = 0.08,
    maintainVisibleContentPosition = CHAT_MAINTAIN_VISIBLE_CONTENT,
    newestItemKey,
    onTouchStart,
    // Message rows own local UI state (reasoning disclosure, image viewer,
    // stop controls), so view reuse stays opt-in until those use recycling state.
    recycleItems = false,
    ...props
  }: MobileMessageScrollerProps<ItemT>,
  ref: React.ForwardedRef<LegendListRef>
) {
  const internalRef = useRef<LegendListRef>(null)
  const combinedRef = useCallback(
    (value: LegendListRef | null) => {
      internalRef.current = value
      if (typeof ref === "function") ref(value)
      else if (ref) ref.current = value
    },
    [ref]
  )
  const isAtEnd = useSharedValue(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const previousNewestItemKeyRef = useRef(newestItemKey)
  const foreground = useThemeColor("foreground")

  useAnimatedReaction(
    () => isAtEnd.value,
    (atEnd, wasAtEnd) => {
      if (atEnd !== wasAtEnd) runOnJS(setShowJumpButton)(!atEnd)
    },
    [isAtEnd]
  )

  useEffect(() => {
    const previousKey = previousNewestItemKeyRef.current
    if (
      previousKey &&
      newestItemKey &&
      previousKey !== newestItemKey &&
      showJumpButton
    ) {
      setHasNewActivity(true)
    }
    previousNewestItemKeyRef.current = newestItemKey
  }, [newestItemKey, showJumpButton])

  useEffect(() => {
    if (!showJumpButton) setHasNewActivity(false)
  }, [showJumpButton])

  const dismissKeyboardOnTouch = useCallback<
    NonNullable<LegendListProps<ItemT>["onTouchStart"]>
  >(
    (event) => {
      Keyboard.dismiss()
      void KeyboardController.dismiss().catch(() => undefined)
      onTouchStart?.(event)
    },
    [onTouchStart]
  )

  const jumpToLatest = useCallback(() => {
    setHasNewActivity(false)
    void internalRef.current?.scrollToEnd({ animated: true })
  }, [])

  const jumpLabel = isMerlinResponding
    ? "Merlin is responding"
    : hasNewActivity
      ? "New messages"
      : "Jump to latest"

  return (
    <View className="relative flex-1">
      <KeyboardAwareLegendList
        {...props}
        ref={combinedRef}
        alignItemsAtEnd={alignItemsAtEnd}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentInsetEndAdjustment={keyboardProps.contentInsetEndAdjustment}
        freeze={keyboardProps.freeze}
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={keyboardProps.bottomOffset}
        keyboardShouldPersistTaps="handled"
        maintainScrollAtEnd={maintainScrollAtEnd}
        maintainScrollAtEndThreshold={maintainScrollAtEndThreshold}
        maintainVisibleContentPosition={maintainVisibleContentPosition}
        onTouchStart={dismissKeyboardOnTouch}
        recycleItems={recycleItems}
        sharedValues={{ isAtEnd }}
      />
      {showJumpButton ? (
        <Button
          accessibilityLabel={jumpLabel}
          className="absolute bottom-three self-center rounded-full border border-separator bg-background px-three shadow-sm"
          onPress={jumpToLatest}
          size="sm"
          variant="outline"
        >
          <View className="flex-row items-center gap-two">
            {isMerlinResponding ? (
              <Spinner accessibilityLabel="Merlin is responding" size="sm" />
            ) : null}
            <Text className="text-xs font-medium text-foreground">
              {jumpLabel}
            </Text>
            <SymbolView
              name={{
                ios: "arrow.down",
                android: "arrow_downward",
                web: "arrow_downward",
              }}
              size={14}
              tintColor={foreground}
            />
          </View>
        </Button>
      ) : null}
    </View>
  )
}

export const MobileMessageScroller = forwardRef(MobileMessageScrollerInner) as <
  ItemT,
>(
  props: MobileMessageScrollerProps<ItemT> & RefAttributes<LegendListRef>
) => React.ReactElement
