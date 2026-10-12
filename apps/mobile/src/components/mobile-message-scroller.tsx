import { KeyboardAwareLegendList } from "@legendapp/list/keyboard"
import type {
  LegendListProps,
  LegendListRef,
} from "@legendapp/list/react-native"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import {
  type Ref,
  useCallback,
  useEffect,
  useMemo,
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
import { withUniwind } from "uniwind"
import type { ChatMessageListKeyboardProps } from "@/components/chat-keyboard-layout"
import { Button } from "@/components/ui/button"

type MobileMessageScrollerProps<ItemT> = Omit<
  LegendListProps<ItemT>,
  "inverted" | "refScrollView" | "renderScrollComponent" | "sharedValues"
> & {
  isLorResponding?: boolean
  keyboardProps: ChatMessageListKeyboardProps
  newestItemKey?: string | null
  ref?: Ref<LegendListRef>
}

const CHAT_MAINTAIN_SCROLL_AT_END = { animated: false } as const
const CHAT_MAINTAIN_VISIBLE_CONTENT = { data: true } as const
const JUMP_TO_LATEST_REVEAL_DISTANCE = 160

export function MobileMessageScroller<ItemT>({
  alignItemsAtEnd = true,
  isLorResponding = false,
  keyboardProps,
  maintainScrollAtEnd = CHAT_MAINTAIN_SCROLL_AT_END,
  maintainScrollAtEndThreshold = 0.08,
  maintainVisibleContentPosition = CHAT_MAINTAIN_VISIBLE_CONTENT,
  newestItemKey,
  onScroll,
  onTouchStart,
  ref,
  // Message rows own local UI state (reasoning disclosure, image viewer,
  // stop controls), so view reuse stays opt-in until those use recycling state.
  recycleItems = false,
  ...props
}: MobileMessageScrollerProps<ItemT>) {
  const UniwindKeyboardAwareLegendList = useMemo(
    () => withUniwind(KeyboardAwareLegendList<ItemT>),
    []
  )
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
  const [isAwayFromEnd, setIsAwayFromEnd] = useState(false)
  const [isMeaningfullyScrolledUp, setIsMeaningfullyScrolledUp] =
    useState(false)
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const previousNewestItemKeyRef = useRef(newestItemKey)
  const foreground = useThemeColor("foreground")

  useAnimatedReaction(
    () => isAtEnd.value,
    (atEnd, wasAtEnd) => {
      if (atEnd !== wasAtEnd) runOnJS(setIsAwayFromEnd)(!atEnd)
    },
    [isAtEnd]
  )

  const handleScroll = useCallback<
    NonNullable<LegendListProps<ItemT>["onScroll"]>
  >(
    (event) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent
      const distanceFromEnd = Math.max(
        0,
        contentSize.height - layoutMeasurement.height - contentOffset.y
      )
      setIsMeaningfullyScrolledUp(
        distanceFromEnd >= JUMP_TO_LATEST_REVEAL_DISTANCE
      )
      onScroll?.(event)
    },
    [onScroll]
  )

  const showJumpButton =
    isAwayFromEnd && (isLorResponding || isMeaningfullyScrolledUp)

  useEffect(() => {
    const previousKey = previousNewestItemKeyRef.current
    if (
      previousKey &&
      newestItemKey &&
      previousKey !== newestItemKey &&
      isAwayFromEnd
    ) {
      setHasNewActivity(true)
    }
    previousNewestItemKeyRef.current = newestItemKey
  }, [newestItemKey, isAwayFromEnd])

  useEffect(() => {
    if (!isAwayFromEnd) setHasNewActivity(false)
  }, [isAwayFromEnd])

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
    setIsAwayFromEnd(false)
    setIsMeaningfullyScrolledUp(false)
    void internalRef.current?.scrollToEnd({ animated: true })
  }, [])

  const jumpLabel = isLorResponding
    ? "Lor is responding"
    : hasNewActivity
      ? "New messages"
      : "Jump to latest"

  return (
    <View className="relative flex-1">
      <UniwindKeyboardAwareLegendList
        {...props}
        ref={combinedRef}
        alignItemsAtEnd={alignItemsAtEnd}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        freeze={keyboardProps.freeze}
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={keyboardProps.bottomOffset}
        keyboardShouldPersistTaps="handled"
        maintainScrollAtEnd={maintainScrollAtEnd}
        maintainScrollAtEndThreshold={maintainScrollAtEndThreshold}
        maintainVisibleContentPosition={maintainVisibleContentPosition}
        onScroll={handleScroll}
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
            {isLorResponding ? (
              <Spinner accessibilityLabel="Lor is responding" size="sm" />
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
