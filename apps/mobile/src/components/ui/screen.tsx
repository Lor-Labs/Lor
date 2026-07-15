import type { ComponentProps } from "react"
import { SafeAreaView } from "react-native-safe-area-context"
import { withUniwind } from "uniwind"

const UniwindSafeAreaView = withUniwind(SafeAreaView)

type ScreenProps = ComponentProps<typeof SafeAreaView> & {
  className?: string
}

/**
 * Full-viewport route container with safe-area insets and Uniwind support.
 * Keep the explicit flex style as a layout invariant for every native screen.
 */
export function Screen({ className, style, ...props }: ScreenProps) {
  return (
    <UniwindSafeAreaView
      {...props}
      className={`flex-1 ${className ?? ""}`}
      style={[style, { flex: 1 }]}
    />
  )
}
