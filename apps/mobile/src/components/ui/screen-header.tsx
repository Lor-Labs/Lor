import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"

// The bar on a pushed screen, to the same measure as the app's other pushed
// screens: back, a title with an optional line under it (the channel or
// workspace it belongs to), and the screen's own actions.
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  // Where back goes when there is no screen to return to (a deep link).
  onBack?: () => void
  right?: ReactNode
}) {
  const foreground = useThemeColor("foreground")
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else if (onBack) onBack()
    else router.replace("/")
  }
  return (
    <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
      <IconButton accessibilityLabel="Back" onPress={goBack} variant="ghost">
        <SymbolView
          name={{
            ios: "chevron.left",
            android: "arrow_back",
            web: "arrow_back",
          }}
          size={21}
          tintColor={foreground}
        />
      </IconButton>
      <View className="min-w-0 flex-1 gap-px">
        <Text
          accessibilityRole="header"
          className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="text-xs font-medium leading-4 text-muted"
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}
