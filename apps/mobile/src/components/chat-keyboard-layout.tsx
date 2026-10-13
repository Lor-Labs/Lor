import { type ReactNode, useCallback, useId, useMemo } from "react"
import { StyleSheet, View } from "react-native"
import {
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller"
import { type SharedValue, useSharedValue } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const COMPOSER_INPUT_HEIGHT = 48

export type ChatComposerKeyboardProps = {
  inputNativeID: string
  onCustomInputViewChange: (isOpen: boolean) => void
}

// The composer sits below the list in the layout, so its growth already
// shrinks the list. No extra content inset for it: that counted it twice and
// left a blank band above the composer after a scroll to the end.
export type ChatMessageListKeyboardProps = {
  bottomOffset: number
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
  const freeze = useSharedValue(false)

  const onCustomInputViewChange = useCallback(
    (isOpen: boolean) => {
      freeze.value = isOpen
    },
    [freeze]
  )

  const messageListKeyboardProps = useMemo<ChatMessageListKeyboardProps>(
    () => ({ bottomOffset: bottomInset, freeze }),
    [bottomInset, freeze]
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
          {renderComposer({ inputNativeID, onCustomInputViewChange })}
        </View>
      </KeyboardStickyView>
    </KeyboardGestureArea>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
})
