import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Radio } from "heroui-native/radio"
import { useEffect, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { RadioGroup } from "@/components/ui/radio-group"
import { Screen } from "@/components/ui/screen"
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "@/lib/theme-preference"

const THEME_OPTIONS: Array<{
  value: ThemePreference
  label: string
  detail: string
}> = [
  { value: "light", label: "Light", detail: "Bright surfaces, dark text." },
  { value: "dark", label: "Dark", detail: "Dark surfaces, light text." },
  {
    value: "system",
    label: "System",
    detail: "Follows your device appearance.",
  },
]

export default function AppearanceSettingsScreen() {
  const foreground = useThemeColor("foreground")
  const [preference, setPreference] = useState<ThemePreference | null>(null)

  useEffect(() => {
    void loadThemePreference().then(setPreference)
  }, [])

  const selectTheme = (value: string) => {
    const next = value as ThemePreference
    setPreference(next)
    void saveThemePreference(next)
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back"
          onPress={() => router.back()}
          variant="ghost"
        >
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
        <Text className="flex-1 text-[17px] font-bold text-foreground">
          Appearance
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-four px-four pb-eight pt-five"
        showsVerticalScrollIndicator={false}
      >
        <Text className="px-one text-xs font-semibold uppercase tracking-[0.8px] text-muted">
          Theme
        </Text>
        {preference ? (
          <RadioGroup onValueChange={selectTheme} value={preference}>
            {THEME_OPTIONS.map((option) => (
              <RadioGroup.Item
                className="min-h-[56px] rounded-lor-md border border-border bg-surface px-four py-three"
                key={option.value}
                value={option.value}
              >
                <View className="min-w-0 flex-1 gap-px">
                  <Text className="text-[15px] font-semibold text-foreground">
                    {option.label}
                  </Text>
                  <Text className="text-xs text-muted">{option.detail}</Text>
                </View>
                <Radio />
              </RadioGroup.Item>
            ))}
          </RadioGroup>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
