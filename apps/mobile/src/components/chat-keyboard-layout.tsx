import {
  type ComponentRef,
  forwardRef,
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
} from "react"
import {
  type LayoutChangeEvent,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native"
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller"
import { useSharedValue, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const COMPOSER_INPUT_HEIGHT = 48
const COMPOSER_RESIZE_DURATION_MS = 100

export type ChatComposerKeyboardProps = {
  inputNativeID: string
  onCustomInputViewChange: (isOpen: boolean) => void
}

type ChatScrollViewProps = KeyboardChatScrollViewProps & {
  bottomOffset: number
}

const ChatScrollView = forwardRef<
  ComponentRef<typeof KeyboardChatScrollView>,
  ChatScrollViewProps
>(({ bottomOffset, ...props }, ref) => (
  <KeyboardChatScrollView
    {...props}
    automaticallyAdjustContentInsets={false}
    contentInsetAdjustmentBehavior="never"
    inverted
    keyboardLiftBehavior="whenAtEnd"
    offset={bottomOffset}
    ref={ref}
  />
))

ChatScrollView.displayName = "ChatScrollView"

export function ChatKeyboardLayout({
  renderComposer,
  renderMessageList,
  typingIndicator,
}: {
  renderComposer: (props: ChatComposerKeyboardProps) => ReactNode
  renderMessageList: (
    renderScrollComponent: (
      props: ScrollViewProps
    ) => ReactElement<ScrollViewProps>
  ) => ReactNode
  typingIndicator?: ReactNode
}) {
  const { bottom: bottomInset } = useSafeAreaInsets()
  const reactId = useId()
  const inputNativeID = useMemo(
    () => `message-composer-${reactId.replaceAll(":", "")}`,
    [reactId]
  )
  const extraContentPadding = useSharedValue(0)
  const freeze = useSharedValue(false)
  const baselineComposerHeightRef = useRef<number | null>(null)

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.round(event.nativeEvent.layout.height)
      if (height <= 0) return

      const previousBaseline = baselineComposerHeightRef.current
      const baseline =
        previousBaseline === null ? height : Math.min(previousBaseline, height)

      baselineComposerHeightRef.current = baseline
      extraContentPadding.value = withTiming(Math.max(height - baseline, 0), {
        duration: COMPOSER_RESIZE_DURATION_MS,
      })
    },
    [extraContentPadding]
  )

  const onCustomInputViewChange = useCallback(
    (isOpen: boolean) => {
      freeze.value = isOpen
    },
    [freeze]
  )

  const renderScrollComponent = useCallback(
    (props: ScrollViewProps): ReactElement<ScrollViewProps> => (
      <ChatScrollView
        {...props}
        bottomOffset={bottomInset}
        extraContentPadding={extraContentPadding}
        freeze={freeze}
      />
    ),
    [bottomInset, extraContentPadding, freeze]
  )

  return (
    <KeyboardGestureArea
      interpolator="ios"
      offset={COMPOSER_INPUT_HEIGHT}
      style={styles.container}
      textInputNativeID={inputNativeID}
    >
      {renderMessageList(renderScrollComponent)}
      <KeyboardStickyView offset={{ opened: bottomInset }}>
        <View collapsable={false} onLayout={onComposerLayout}>
          {typingIndicator}
          {renderComposer({
            inputNativeID,
            onCustomInputViewChange,
          })}
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
})
