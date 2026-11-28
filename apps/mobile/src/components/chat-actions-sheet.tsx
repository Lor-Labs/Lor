import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon"
import MailOpen01Icon from "@hugeicons/core-free-icons/MailOpen01Icon"
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon"
import NotificationOff01Icon from "@hugeicons/core-free-icons/NotificationOff01Icon"
import PinIcon from "@hugeicons/core-free-icons/PinIcon"
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon"
import ViewOffSlashIcon from "@hugeicons/core-free-icons/ViewOffSlashIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import { ChatAvatar } from "@/components/chat-avatar"
import { useMutePrompt } from "@/components/mute-sheet"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { useUnread } from "@/context/unread-context"
import { agentCreature, useAgentsById } from "@/hooks/use-agents"
import { mutedUntilLabel, useChannelMutes } from "@/hooks/use-channel-mutes"
import type { Chat } from "@/hooks/use-chats"
import { openExternalUrl } from "@/lib/open-url"

// A chat's actions, from a long press on its row: what the web's right
// click offers, in a sheet the thumb reaches.
export function ChatActionsSheet({
  chat,
  me,
  workspaceSlug,
  canManage,
  onOpenChange,
  onPin,
  onHide,
  onUnarchive,
  onOpenDetails,
}: {
  chat: Chat | null
  me: string | undefined
  workspaceSlug: string
  canManage: boolean
  onOpenChange: (isOpen: boolean) => void
  onPin: (chat: Chat) => void
  onHide: (chat: Chat) => void
  onUnarchive: (chat: Chat) => void
  onOpenDetails: (chat: Chat) => void
}) {
  const agentsById = useAgentsById(workspaceSlug)
  const { getMute } = useChannelMutes()
  const { promptMute, muteSheet } = useMutePrompt()
  const { getUnreadCount, getMentionCount, markChannelRead } = useUnread()
  const close = () => onOpenChange(false)

  const body = (() => {
    if (!chat) return null
    const name = chat.name ?? "Chat"
    const agents = chat.agentIds.flatMap((id) => agentsById.get(id) ?? [])
    const others = chat.people.filter((person) => person.id !== me)
    const people = others.length + agents.length > 0 ? others : chat.people
    const archived = Boolean(chat.archivedAt)
    const place = chat.place
    const mute = archived || place ? null : getMute(chat.id)
    const hasActivity =
      getUnreadCount(chat.id) > 0 || getMentionCount(chat.id) > 0
    const who = [
      agents.length > 0 ? agents.map((agent) => agent.name).join(", ") : null,
      chat.peopleCount > 0
        ? `${chat.peopleCount} ${chat.peopleCount === 1 ? "person" : "people"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ")

    return (
      <>
        <View className="flex-row items-center gap-three px-one pb-four">
          <ChatAvatar
            agents={agents.map((agent) => ({
              id: agent.id,
              creature: agentCreature(agent),
            }))}
            people={people}
            size={44}
            total={agents.length + others.length}
          />
          <View className="min-w-0 flex-1 gap-px">
            <BottomSheet.Title numberOfLines={1}>{name}</BottomSheet.Title>
            <BottomSheet.Description numberOfLines={1}>
              {place
                ? "In Discord"
                : archived
                  ? "Archived"
                  : who || "Nobody else yet"}
            </BottomSheet.Description>
          </View>
        </View>
        <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
          {place ? (
            <Action
              icon={DiscordIcon}
              label="Open in Discord"
              onPress={() => {
                close()
                openExternalUrl(place.url)
              }}
            />
          ) : archived ? (
            canManage ? (
              <Action
                icon={ArchiveRestoreIcon}
                label="Unarchive chat"
                onPress={() => {
                  close()
                  onUnarchive(chat)
                }}
              />
            ) : null
          ) : (
            <>
              <Action
                icon={chat.pinnedAt ? PinOffIcon : PinIcon}
                label={chat.pinnedAt ? "Unpin" : "Pin"}
                onPress={() => {
                  triggerHaptic("medium")
                  close()
                  onPin(chat)
                }}
              />
              {hasActivity ? (
                <Action
                  icon={MailOpen01Icon}
                  label="Mark as read"
                  onPress={() => {
                    triggerHaptic("soft")
                    markChannelRead(chat.id)
                    close()
                  }}
                />
              ) : null}
              <Action
                detail={mute ? mutedUntilLabel(mute.mutedUntil) : undefined}
                icon={mute ? Notification01Icon : NotificationOff01Icon}
                label={mute ? "Unmute" : "Mute"}
                onPress={() => {
                  close()
                  promptMute({ channelId: chat.id, channelLabel: name, mute })
                }}
              />
              <Action
                detail="Until someone writes in it"
                icon={ViewOffSlashIcon}
                label="Hide"
                onPress={() => {
                  triggerHaptic("medium")
                  close()
                  onHide(chat)
                }}
              />
            </>
          )}
          <Action
            icon={InformationCircleIcon}
            label="Chat details"
            last
            onPress={() => {
              close()
              onOpenDetails(chat)
            }}
          />
        </View>
      </>
    )
  })()

  return (
    <>
      <BottomSheet isOpen={chat !== null} onOpenChange={onOpenChange}>
        <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
          <BottomSheet.Overlay className="bg-neutral-950/50" />
          <BottomSheet.Content>
            <View className="pb-six">{body}</View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
      {muteSheet}
    </>
  )
}

function Action({
  icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  icon: IconSvgElement
  label: string
  detail?: string
  onPress: () => void
  last?: boolean
}) {
  const foreground = useThemeColor("foreground")
  return (
    <PressableRow
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-[52px] flex-row items-center gap-three px-four"
      highlightClassName="bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon
        color={foreground}
        icon={icon}
        size={20}
        strokeWidth={1.8}
      />
      <View
        className={`min-h-[52px] min-w-0 flex-1 justify-center gap-px ${
          last ? "" : "border-b border-separator"
        }`}
      >
        <Text className="text-[16px] text-foreground">{label}</Text>
        {detail ? (
          <Text className="text-xs text-muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </PressableRow>
  )
}
