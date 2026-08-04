import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useMemo, useRef, useState } from "react"
import { Alert, FlatList, Pressable, Text, View } from "react-native"
import type { MessageComposerMentionHandle } from "@/components/message-composer"
import { MessageRow } from "@/components/message-row"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { useOpenDM } from "@/hooks/use-open-dm"
import { usePinnedMessages } from "@/hooks/use-pinned-messages"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function PinnedMessagesScreen() {
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null)
  const foreground = useThemeColor("foreground")
  const { workspace } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { data: session } = authClient.useSession()
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const permissions = useChannelPermissions(workspace?.id)
  const pins = usePinnedMessages({
    channelId: channelId ?? "",
    enabled: Boolean(workspace?.slug && channelId),
    workspaceSlug: workspace?.slug ?? "",
  })
  const { members } = useWorkspaceMembers(workspace?.slug ?? "")
  const avatarColorByUserId = useMemo(
    () => new Map(members.map((member) => [member.userId, member.avatarColor])),
    [members]
  )
  // No composer on this screen — the profile sheet's Mention action stays off.
  const mentionRef = useRef<MessageComposerMentionHandle>(null)
  const { closeProfile, openAuthorProfile, profileUser } = useProfileSheet({
    avatarColorByUserId,
    members,
    mentionRef,
  })
  const { openDM } = useOpenDM()

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else if (channelId) {
      router.replace({
        pathname: "/channel/[channelId]",
        params: { channelId },
      })
    } else router.replace("/")
  }

  const openMessage = (message: Message) => {
    if (!channelId) return
    if (message.threadRootId) {
      router.replace({
        pathname: "/channel/[channelId]/thread/[threadRootId]",
        params: {
          channelId,
          focusMessageId: message.id,
          threadRootId: message.threadRootId,
        },
      })
      return
    }
    router.dismissTo({
      pathname: "/channel/[channelId]",
      params: { channelId, focusMessageId: message.id },
    })
  }

  const openThread = (message: Message) => {
    if (!channelId) return
    router.replace({
      pathname: "/channel/[channelId]/thread/[threadRootId]",
      params: { channelId, threadRootId: message.id },
    })
  }

  const unpinMessage = async (message: Message) => {
    if (!workspace?.slug || !channelId || pendingMessageId) return
    setPendingMessageId(message.id)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].messages[":messageId"].pin.$patch({
        param: {
          workspaceSlug: workspace.slug,
          channelId,
          messageId: message.id,
        },
      })
      if (!response.ok) throw new Error("Could not unpin this message")
      const result = await response.json()
      if (!result.pinned) pins.remove(message.id)
    } catch (cause) {
      Alert.alert(
        "Message not unpinned",
        cause instanceof Error ? cause.message : "Please try again in a moment."
      )
    } finally {
      setPendingMessageId(null)
    }
  }

  const channelName = channelState.channel?.name ?? "channel"

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back to channel options"
          onPress={goBack}
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
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-[17px] font-bold tracking-[-0.2px] text-foreground">
            Pinned messages
          </Text>
          <Text className="text-xs font-medium leading-4 text-muted">
            #{channelName}
          </Text>
        </View>
        {!pins.isLoading && pins.messages.length > 0 ? (
          <Text className="mr-two text-xs font-semibold text-muted">
            {pins.messages.length}
          </Text>
        ) : null}
      </View>

      {pins.isLoading && pins.messages.length === 0 ? (
        <PinnedMessagesSkeleton />
      ) : pins.error && pins.messages.length === 0 ? (
        <StatePanel
          action={{ label: "Try again", onPress: () => void pins.reload() }}
          className="flex-1"
          detail={pins.error}
          status="danger"
          title="Pinned messages are unavailable"
        />
      ) : pins.messages.length === 0 ? (
        <StatePanel
          className="flex-1"
          detail={`Messages pinned in #${channelName} will appear here.`}
          title="Nothing pinned yet"
        />
      ) : (
        <FlatList
          className="flex-1 bg-background"
          contentContainerStyle={{ paddingBottom: 32 }}
          data={pins.messages}
          keyExtractor={(message) => message.id}
          ListHeaderComponent={
            <View className="flex-row items-center gap-two px-four pb-two pt-four">
              <HugeiconsIcon color={foreground} icon={Pin02Icon} size={16} />
              <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-muted">
                Pinned in #{channelName}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="border-b border-separator pb-two pt-one">
              <MessageRow
                message={item}
                onOpenThread={openThread}
                onPressAuthor={openAuthorProfile}
                showHeader
              />
              <View className="flex-row justify-end gap-two px-four">
                <Pressable
                  accessibilityLabel="View message in conversation"
                  accessibilityRole="button"
                  className="min-h-9 justify-center rounded-lor-sm px-three active:bg-surface-secondary"
                  onPress={() => openMessage(item)}
                >
                  <Text className="text-sm font-semibold text-accent">
                    View in conversation
                  </Text>
                </Pressable>
                {permissions.canPinMessages ? (
                  <Pressable
                    accessibilityLabel="Unpin message"
                    accessibilityRole="button"
                    className="size-9 items-center justify-center rounded-lor-sm bg-surface-secondary active:bg-surface-tertiary"
                    disabled={pendingMessageId !== null}
                    onPress={() => void unpinMessage(item)}
                  >
                    {pendingMessageId === item.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <HugeiconsIcon
                        color={foreground}
                        icon={PinOffIcon}
                        size={18}
                      />
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
      <UserProfileSheet
        currentUserId={session?.user.id}
        onMessage={(target) => {
          closeProfile()
          void openDM(target.id)
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeProfile()
        }}
        user={profileUser}
      />
    </Screen>
  )
}

function PinnedMessagesSkeleton() {
  return (
    <View className="flex-1 gap-six px-four py-five">
      {[0, 1, 2].map((index) => (
        <View className="flex-row gap-three" key={index}>
          <Skeleton className="size-10" />
          <View className="flex-1 gap-two pt-one">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </View>
        </View>
      ))}
    </View>
  )
}
