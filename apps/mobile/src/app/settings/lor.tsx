import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Radio } from "heroui-native/radio"
import { useToast } from "heroui-native/toast"
import { ScrollView, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { RadioGroup } from "@/components/ui/radio-group"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { api } from "@/lib/api"
import type { SandboxSettings } from "@/lib/api-types"

const SANDBOX_SETTINGS_KEY = ["sandbox-settings"] as const

const SANDBOX_MODE_OPTIONS = [
  {
    value: "manual",
    label: "Manual",
    detail: "Lor asks before every command and file change.",
  },
  {
    value: "auto",
    label: "Auto",
    detail: "Lor runs routine commands and asks before risky ones.",
  },
  {
    value: "bypass",
    label: "Bypass",
    detail: "Lor runs every command and file change without asking.",
  },
] as const

export default function LorSettingsScreen() {
  const foreground = useThemeColor("foreground")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: SANDBOX_SETTINGS_KEY,
    queryFn: async () => {
      const response = await api.v1["sandbox-settings"].$get()
      if (!response.ok) throw new Error("Could not load Lor settings")
      return response.json()
    },
  })
  const settings = settingsQuery.data ?? null
  const error = settings ? null : (settingsQuery.error?.message ?? null)

  const update = (sandboxMode: SandboxSettings["sandboxMode"]) => {
    if (!settings) return
    const previous = settings.sandboxMode
    queryClient.setQueryData<SandboxSettings>(SANDBOX_SETTINGS_KEY, {
      sandboxMode,
    })
    void api.v1["sandbox-settings"]
      .$patch({ json: { sandboxMode } })
      .then((response) => {
        if (!response.ok) throw new Error()
      })
      .catch(() => {
        // Revert only if a newer choice hasn't already replaced this one.
        queryClient.setQueryData<SandboxSettings>(
          SANDBOX_SETTINGS_KEY,
          (current) =>
            current?.sandboxMode === sandboxMode
              ? { sandboxMode: previous }
              : current
        )
        toast.show({
          variant: "danger",
          label: "Setting not saved",
          description: "Please try again in a moment.",
        })
      })
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
          Lor
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-six px-four pb-eight pt-five"
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <StatePanel
            action={{
              label: "Try again",
              onPress: () => void settingsQuery.refetch(),
            }}
            detail={error}
            status="danger"
            title="Settings are unavailable"
          />
        ) : settings ? (
          <View className="gap-two">
            <View className="gap-px px-one">
              <Text className="text-xs font-semibold uppercase tracking-[0.8px] text-muted">
                Sandbox Commands
              </Text>
              <Text className="text-xs text-muted">
                When Lor asks before it runs a command or changes a file in
                turns you start. Anyone in the session can answer. Reading files
                never asks.
              </Text>
            </View>
            <RadioGroup
              onValueChange={(next) =>
                update(next as SandboxSettings["sandboxMode"])
              }
              value={settings.sandboxMode}
            >
              {SANDBOX_MODE_OPTIONS.map((option) => (
                <RadioGroup.Item
                  className="min-h-[52px] rounded-lor-md border border-border bg-surface px-four py-three"
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
          </View>
        ) : (
          <View className="gap-two">
            <Skeleton className="h-2.5 w-40 rounded-full" />
            {SANDBOX_MODE_OPTIONS.map((option) => (
              <Skeleton
                className="h-[52px] rounded-lor-md"
                key={option.value}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}
