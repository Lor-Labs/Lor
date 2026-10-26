import { features } from "@repo/utils/features"
import { useQueries } from "@tanstack/react-query"
import { NativeTabs } from "expo-router/unstable-native-tabs"

import { useTabAvatarIcon } from "@/components/tab-avatar-icon"
import { useUnread } from "@/context/unread-context"
import { useWorkspace } from "@/context/workspace-context"
import { useDMs } from "@/hooks/use-dms"
import { useTheme } from "@/hooks/use-theme"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels"

function tabBadge(count: number) {
  return count > 99 ? "99+" : String(count)
}

export default function AppTabs() {
  const colors = useTheme()
  const { getMentionCount, getUnreadCount } = useUnread()
  const { workspaces } = useWorkspace()
  const channelLists = useQueries({
    queries: workspaces.map((workspace) =>
      workspaceChannelsQueryOptions(workspace.slug)
    ),
  })
  const { dms } = useDMs()
  const { source: avatarSource, canvas: avatarCanvas } = useTabAvatarIcon()

  const dmUnreadCount = dms.reduce(
    (total, dm) => total + (getUnreadCount(dm.id) || getMentionCount(dm.id)),
    0
  )
  const homeMentionCount = channelLists.reduce((total, { data }) => {
    if (!data) return total
    return (
      total +
      [
        ...data.uncategorized,
        ...data.categories.flatMap((category) => category.channels),
      ].reduce((count, channel) => count + getMentionCount(channel.id), 0)
    )
  }, 0)

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
          {homeMentionCount > 0 ? (
            <NativeTabs.Trigger.Badge>
              {tabBadge(homeMentionCount)}
            </NativeTabs.Trigger.Badge>
          ) : null}
          <NativeTabs.Trigger.Icon
            md={{ default: "home", selected: "home" }}
            sf={{ default: "house", selected: "house.fill" }}
          />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="dms" hidden={!features.directMessages}>
          <NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label>
          {dmUnreadCount > 0 ? (
            <NativeTabs.Trigger.Badge>
              {tabBadge(dmUnreadCount)}
            </NativeTabs.Trigger.Badge>
          ) : null}
          <NativeTabs.Trigger.Icon
            md={{ default: "chat_bubble_outline", selected: "chat_bubble" }}
            sf={{ default: "message", selected: "message.fill" }}
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
