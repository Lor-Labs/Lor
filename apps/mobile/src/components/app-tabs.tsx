import { NativeTabs } from "expo-router/unstable-native-tabs"

import { useUnread } from "@/context/unread-context"
import { useTheme } from "@/hooks/use-theme"

export default function AppTabs() {
  const colors = useTheme()
  const { totalMentionCount } = useUnread()

  return (
    <NativeTabs
      iconColor={{ default: colors.textSecondary, selected: colors.accent }}
      labelStyle={{
        default: { color: colors.textSecondary },
        selected: { color: colors.accent },
      }}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={totalMentionCount === 0}>
          {totalMentionCount > 99 ? "99+" : String(totalMentionCount)}
        </NativeTabs.Trigger.Badge>
        <NativeTabs.Trigger.Icon
          md={{ default: "home", selected: "home" }}
          sf={{ default: "house", selected: "house.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "notifications_none", selected: "notifications" }}
          sf={{ default: "bell", selected: "bell.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
