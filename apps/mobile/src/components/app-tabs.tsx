import { NativeTabs } from "expo-router/unstable-native-tabs"

import { useTabAvatarIcon } from "@/components/tab-avatar-icon"
import { useUnread } from "@/context/unread-context"
import { useTheme } from "@/hooks/use-theme"

export default function AppTabs() {
  const colors = useTheme()
  const { totalMentionCount } = useUnread()
  const { source: avatarSource, canvas: avatarCanvas } = useTabAvatarIcon()

  return (
    <>
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
          {totalMentionCount > 0 ? (
            <NativeTabs.Trigger.Badge>
              {totalMentionCount > 99 ? "99+" : String(totalMentionCount)}
            </NativeTabs.Trigger.Badge>
          ) : null}
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

        <NativeTabs.Trigger name="you">
          <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
          {avatarSource ? (
            <NativeTabs.Trigger.Icon
              renderingMode="original"
              src={avatarSource}
            />
          ) : (
            <NativeTabs.Trigger.Icon
              md={{ default: "account_circle", selected: "account_circle" }}
              sf={{
                default: "person.crop.circle",
                selected: "person.crop.circle.fill",
              }}
            />
          )}
        </NativeTabs.Trigger>
      </NativeTabs>
      {avatarCanvas}
    </>
  )
}
