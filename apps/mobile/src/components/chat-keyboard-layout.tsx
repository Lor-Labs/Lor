import { type ReactNode, useCallback, useId, useMemo, useRef } from "react"
import { type LayoutChangeEvent, StyleSheet, View } from "react-native"
import {
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller"
import {
  type SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const COMPOSER_INPUT_HEIGHT = 48
const COMPOSER_RESIZE_DURATION_MS = 100

export type ChatComposerKeyboardProps = {
  inputNativeID: string
  onCustomInputViewChange: (isOpen: boolean) => void
  onInputLayout: (event: LayoutChangeEvent) => void
}

export type ChatMessageListKeyboardProps = {
  bottomOffset: number
  contentInsetEndAdjustment: SharedValue<number>
  freeze: SharedValue<boolean>
}

export function ChatKeyboardLayout({
  renderComposer,
  renderMessageList,
  typingIndicator,
}: {
  renderComposer: (props: ChatComposerKeyboardProps) => ReactNode
  renderMessageList: (keyboardProps: ChatMessageListKeyboardProps) => ReactNode
  typingIndicator?: ReactNode
}) {
  const { bottom: bottomInset } = useSafeAreaInsets()
  const reactId = useId()
  const inputNativeID = useMemo(
    () => `message-composer-${reactId.replaceAll(":", "")}`,
    [reactId]
  )
  const contentInsetEndAdjustment = useSharedValue(0)
  const freeze = useSharedValue(false)
  const baselineInputHeightRef = useRef<number | null>(null)

  const onInputLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.round(event.nativeEvent.layout.height)
      if (height <= 0) return

      const previousBaseline = baselineInputHeightRef.current
      const baseline =
        previousBaseline === null ? height : Math.min(previousBaseline, height)

      baselineInputHeightRef.current = baseline
      contentInsetEndAdjustment.value = withTiming(
        Math.max(height - baseline, 0),
        { duration: COMPOSER_RESIZE_DURATION_MS }
      )
    },
    [contentInsetEndAdjustment]
  )

  const onCustomInputViewChange = useCallback(
    (isOpen: boolean) => {
      freeze.value = isOpen
    },
    [freeze]
  )

  const messageListKeyboardProps = useMemo<ChatMessageListKeyboardProps>(
    () => ({
      bottomOffset: bottomInset,
      contentInsetEndAdjustment,
      freeze,
    }),
    [bottomInset, contentInsetEndAdjustment, freeze]
  )

  return (
    <KeyboardGestureArea
      interpolator="ios"
      offset={COMPOSER_INPUT_HEIGHT}
      style={styles.container}
      textInputNativeID={inputNativeID}
    >
      {renderMessageList(messageListKeyboardProps)}
      <KeyboardStickyView offset={{ opened: bottomInset }}>
        <View collapsable={false}>
          {typingIndicator}
          {renderComposer({
            inputNativeID,
            onCustomInputViewChange,
            onInputLayout,
          })}
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
})
