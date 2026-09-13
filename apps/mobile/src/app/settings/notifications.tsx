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
import type { NotificationSettings } from "@/lib/api-types"

const DESKTOP_OPTIONS = [
  { value: "all_messages", label: "All Messages" },
  { value: "mentions_only", label: "Mentions Only" },
  { value: "nothing", label: "Nothing" },
] as const

const DM_OPTIONS = [
  { value: "all_messages", label: "All Messages" },
  { value: "nothing", label: "Nothing" },
] as const

const LOR_THREAD_OPTIONS = [
  { value: "all_activity", label: "All Activity" },
  { value: "subscribed_only", label: "Subscribed Threads Only" },
] as const

function OptionGroup<Value extends string>({
  detail,
  onChange,
  options,
  title,
  value,
}: {
  detail: string
  onChange: (value: Value) => void
  options: ReadonlyArray<{ value: Value; label: string }>
  title: string
  value: Value
}) {
  return (
    <View className="gap-two">
      <View className="gap-px px-one">
        <Text className="text-xs font-semibold uppercase tracking-[0.8px] text-muted">
          {title}
        </Text>
        <Text className="text-xs text-muted">{detail}</Text>
      </View>
      <RadioGroup
        onValueChange={(next) => onChange(next as Value)}
        value={value}
      >
        {options.map((option) => (
          <RadioGroup.Item
            className="min-h-[52px] rounded-lor-md border border-border bg-surface px-four py-three"
            key={option.value}
            value={option.value}
          >
            <Text className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
              {option.label}
            </Text>
            <Radio />
          </RadioGroup.Item>
        ))}
      </RadioGroup>
    </View>
  )
}

export default function NotificationSettingsScreen() {
  const foreground = useThemeColor("foreground")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const response = await api.v1["notification-settings"].$get()
      if (!response.ok) throw new Error("Could not load notification settings")
      return response.json()
    },
  })
  const settings = settingsQuery.data ?? null
  const error = settings ? null : (settingsQuery.error?.message ?? null)

  const patchSettings = (
    updater: (current: NotificationSettings) => NotificationSettings
  ) => {
    queryClient.setQueryData<NotificationSettings>(
      ["notification-settings"],
      (current) => (current ? updater(current) : current)
    )
  }

  const update = (patch: Partial<NotificationSettings>) => {
    if (!settings) return
    // Revert only the keys this request touched, and only if a newer choice
    // hasn't already replaced the value this request wrote.
    const revert: Partial<NotificationSettings> = {
      ...(patch.desktopNotifications !== undefined
        ? { desktopNotifications: settings.desktopNotifications }
        : {}),
      ...(patch.dmNotifications !== undefined
        ? { dmNotifications: settings.dmNotifications }
        : {}),
      ...(patch.lorThreadNotifications !== undefined
        ? {
            lorThreadNotifications: settings.lorThreadNotifications,
          }
        : {}),
    }
    patchSettings((current) => ({ ...current, ...patch }))
    void api.v1["notification-settings"]
      .$patch({ json: patch })
      .then((response) => {
        if (!response.ok) throw new Error()
      })
      .catch(() => {
        patchSettings((current) => {
          const next = { ...current }
          if (
            revert.desktopNotifications !== undefined &&
            next.desktopNotifications === patch.desktopNotifications
          ) {
            next.desktopNotifications = revert.desktopNotifications
          }
          if (
            revert.dmNotifications !== undefined &&
            next.dmNotifications === patch.dmNotifications
          ) {
            next.dmNotifications = revert.dmNotifications
          }
          if (
            revert.lorThreadNotifications !== undefined &&
            next.lorThreadNotifications === patch.lorThreadNotifications
          ) {
            next.lorThreadNotifications = revert.lorThreadNotifications
          }
          return next
        })
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
          Notifications
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
          <>
            <OptionGroup
              detail="Messages in workspace channels."
              onChange={(desktopNotifications) =>
                update({ desktopNotifications })
              }
              options={DESKTOP_OPTIONS}
              title="Channel Notifications"
              value={settings.desktopNotifications}
            />
            <OptionGroup
              detail="Replying in a Lor thread subscribes you automatically."
              onChange={(lorThreadNotifications) =>
                update({ lorThreadNotifications })
              }
              options={LOR_THREAD_OPTIONS}
              title="Lor Thread Notifications"
              value={settings.lorThreadNotifications}
            />
            <OptionGroup
              detail="Direct messages sent to you."
              onChange={(dmNotifications) => update({ dmNotifications })}
              options={DM_OPTIONS}
              title="DM Notifications"
              value={settings.dmNotifications}
            />
          </>
        ) : (
          <NotificationSettingsSkeleton />
        )}
      </ScrollView>
    </Screen>
  )
}

function NotificationSettingsSkeleton() {
  return (
    <View className="gap-six">
      {[
        { key: "channels", rows: 3 },
        { key: "lor-threads", rows: 2 },
        { key: "dms", rows: 2 },
      ].map(({ key, rows }, group) => (
        <View className="gap-two" key={key}>
          <Skeleton className="h-2.5 w-40 rounded-full" />
          {Array.from({ length: rows }, (_, index) => index).map((row) => (
            <Skeleton
              className="h-[52px] rounded-lor-md"
              key={`${group}-${row}`}
            />
          ))}
        </View>
      ))}
    </View>
  )
}
