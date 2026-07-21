import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import AtSignIcon from "@hugeicons/core-free-icons/AtSignIcon"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { formatDate } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"

export type UserProfileTarget = {
  id: string
  name: string
  avatarName: string
  image: string | null
  avatarColor: string | null
  detail?: string | null
}

export function UserProfileSheet({
  currentUserId,
  onMention,
  onMessage,
  onOpenChange,
  user,
}: {
  currentUserId?: string
  onMention?: (mention: { id: string; label: string }) => void
  onMessage?: (user: UserProfileTarget) => void
  onOpenChange: (isOpen: boolean) => void
  user: UserProfileTarget | null
}) {
  const [copied, setCopied] = useState(false)
  const [accent, background, foreground] = useThemeColor([
    "accent",
    "background",
    "foreground",
  ])
  const userId = user?.id ?? null

  const query = useQuery({
    queryKey: ["user-profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) throw new Error("Could not load this profile")
      const response = await api.v1.users[":userId"].$get({
        param: { userId },
      })
      if (!response.ok) throw new Error("Could not load this profile")
      const payload = await response.json()
      return payload.user
    },
  })
  const profile = query.data ?? null
  const isLoading = Boolean(userId) && query.isPending
  const error = query.error?.message ?? null
  const { refetch } = query

  useEffect(() => {
    setCopied(false)
  }, [userId])

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timeout)
  }, [copied])

  const displayName = profile
    ? (profile.displayUsername ?? profile.name)
    : (user?.name ?? "")
  const username = profile?.username ?? null
  const isSelf = Boolean(user && currentUserId === user.id)
  const presence = profile?.presenceStatus ?? null
  const subtitle =
    [username ? `@${username}` : null, user?.detail]
      .filter(Boolean)
      .join(" · ") || "Member"
  const mentionLabel =
    (profile
      ? (profile.displayUsername ?? profile.username ?? profile.name)
      : (user?.name ?? "")
    ).trim() || "member"

  const copyUsername = () => {
    const value = username ? `@${username}` : displayName
    void Clipboard.setStringAsync(value)
    triggerHaptic("success")
    setCopied(true)
  }

  const mention = () => {
    if (!(user && onMention)) return
    triggerHaptic("soft")
    onMention({ id: user.id, label: mentionLabel })
  }

  return (
    <BottomSheet isOpen={user !== null} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          snapPoints={["52%", "85%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {user ? (
              <>
                <View className="flex-row items-start gap-three px-one">
                  <View className="relative">
                    <Avatar
                      avatarColor={user.avatarColor}
                      image={profile?.image ?? user.image}
                      name={user.avatarName}
                      size="lg"
                    />
                    {presence ? (
                      <View
                        className={`absolute -bottom-px -right-px size-4 rounded-full ${
                          presence === "online" ? "bg-success" : "bg-danger"
                        }`}
                        style={{ borderColor: background, borderWidth: 3 }}
                      />
                    ) : null}
                  </View>
                  <View className="min-w-0 flex-1 gap-px pt-one">
                    <View className="flex-row items-center gap-two">
                      <Text
                        className="text-[19px] font-bold tracking-[-0.3px] text-foreground"
                        numberOfLines={1}
                      >
                        {displayName}
                      </Text>
                      {isSelf ? (
                        <Text className="rounded-sm bg-accent-soft px-one py-px text-[10px] font-bold text-accent">
                          YOU
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-sm text-muted" numberOfLines={1}>
                      {subtitle}
                    </Text>
                    {presence ? (
                      <Text className="text-xs font-medium capitalize text-muted">
                        {presence}
                      </Text>
                    ) : null}
                  </View>
                  <BottomSheet.Close />
                </View>

                <View className="flex-row gap-three px-one">
                  {onMessage && !isSelf ? (
                    <ActionTile
                      icon={Message01Icon}
                      label="Message"
                      onPress={() => {
                        triggerHaptic("soft")
                        onMessage(user)
                      }}
                      tint={accent}
                    />
                  ) : null}
                  {onMention && !isSelf ? (
                    <ActionTile
                      icon={AtSignIcon}
                      label="Mention"
                      onPress={mention}
                      tint={accent}
                    />
                  ) : null}
                  <ActionTile
                    icon={copied ? Tick02Icon : Copy01Icon}
                    label={copied ? "Copied" : "Copy username"}
                    onPress={copyUsername}
                    tint={foreground}
                  />
                </View>

                {isLoading && !profile ? (
                  <ProfileSkeleton />
                ) : error && !profile ? (
                  <View className="gap-three rounded-lor-lg bg-surface-secondary mx-one px-four py-five">
                    <View className="gap-one">
                      <Text className="text-[15px] font-semibold text-foreground">
                        Profile unavailable
                      </Text>
                      <Text className="text-sm leading-5 text-muted">
                        {error}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel="Retry loading profile"
                      accessibilityRole="button"
                      className="min-h-10 self-start justify-center rounded-lor-sm bg-surface-tertiary px-three active:opacity-70"
                      onPress={() => void refetch()}
                    >
                      <Text className="text-sm font-semibold text-foreground">
                        Try again
                      </Text>
                    </Pressable>
                  </View>
                ) : profile ? (
                  <>
                    {profile.status ? (
                      <View className="gap-two px-one">
                        <SectionLabel>Status</SectionLabel>
                        <View className="rounded-lor-lg bg-surface-secondary px-three py-three">
                          <Text className="text-sm leading-5 text-foreground">
                            {profile.status}
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    {profile.bio ? (
                      <View className="gap-two px-one">
                        <SectionLabel>About</SectionLabel>
                        <Text className="text-sm leading-5 text-foreground">
                          {profile.bio}
                        </Text>
                      </View>
                    ) : null}

                    <View className="gap-two px-one">
                      <SectionLabel>Member since</SectionLabel>
                      <Text className="text-sm leading-5 text-foreground">
                        {formatDate(profile.createdAt)}
                      </Text>
                    </View>
                  </>
                ) : null}
              </>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function ActionTile({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: IconSvgElement
  label: string
  onPress: () => void
  tint: string
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-20 flex-1 items-center justify-center gap-two rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon color={tint} icon={icon} size={22} />
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  )
}

function ProfileSkeleton() {
  return (
    <View className="gap-three px-one">
      <Skeleton className="h-3 w-20 rounded-full" />
      <Skeleton className="h-4 w-[70%] rounded-full" />
      <Skeleton className="h-4 w-[45%] rounded-full" />
    </View>
  )
}
