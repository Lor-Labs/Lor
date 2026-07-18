import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useMemo } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { Avatar } from "@/components/ui/avatar"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import type { WorkspaceMember } from "@/lib/api-types"

export type MemberListItem = {
  avatarColor: string | null
  avatarName: string
  detail: string
  id: string
  image: string | null
  name: string
  status: WorkspaceMember["status"]
}

export function MemberListSheet({
  error = null,
  isLoading = false,
  isOpen,
  members,
  onOpenChange,
  onRetry,
  title,
}: {
  error?: string | null
  isLoading?: boolean
  isOpen: boolean
  members: MemberListItem[]
  onOpenChange: (isOpen: boolean) => void
  onRetry?: () => void
  title: string
}) {
  const foreground = useThemeColor("foreground")
  const { offlineMembers, onlineMembers } = useMemo(() => {
    const byName = (a: MemberListItem, b: MemberListItem) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })

    return {
      onlineMembers: members
        .filter((member) => member.status === "online")
        .sort(byName),
      offlineMembers: members
        .filter((member) => member.status === "offline")
        .sort(byName),
    }
  }, [members])

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["58%", "88%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-three px-one">
              <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                <HugeiconsIcon
                  color={foreground}
                  icon={UserGroupIcon}
                  size={20}
                  strokeWidth={1.8}
                />
              </View>
              <View className="min-w-0 flex-1 gap-px">
                <BottomSheet.Title>{title}</BottomSheet.Title>
                <BottomSheet.Description>
                  {members.length} {members.length === 1 ? "person" : "people"}{" "}
                  · {onlineMembers.length} online
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>

            {isLoading && members.length === 0 ? (
              <MemberListSkeleton />
            ) : error && members.length === 0 ? (
              <View className="gap-three rounded-lor-lg bg-surface-secondary px-four py-five">
                <View className="gap-one">
                  <Text className="text-[15px] font-semibold text-foreground">
                    Members unavailable
                  </Text>
                  <Text className="text-sm leading-5 text-muted">{error}</Text>
                </View>
                {onRetry ? (
                  <Pressable
                    accessibilityLabel="Retry loading members"
                    accessibilityRole="button"
                    className="min-h-10 self-start justify-center rounded-lor-sm bg-surface-tertiary px-three active:opacity-70"
                    onPress={onRetry}
                  >
                    <Text className="text-sm font-semibold text-foreground">
                      Try again
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : members.length === 0 ? (
              <View className="rounded-lor-lg bg-surface-secondary px-four py-five">
                <Text className="text-[15px] font-semibold text-foreground">
                  No members yet
                </Text>
                <Text className="mt-one text-sm leading-5 text-muted">
                  People who join this workspace will appear here.
                </Text>
              </View>
            ) : (
              <>
                {onlineMembers.length > 0 ? (
                  <MemberSection
                    label={`Online · ${onlineMembers.length}`}
                    members={onlineMembers}
                  />
                ) : null}

                {offlineMembers.length > 0 ? (
                  <MemberSection
                    label={`Offline · ${offlineMembers.length}`}
                    members={offlineMembers}
                  />
                ) : null}
              </>
            )}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function MemberSection({
  label,
  members,
}: {
  label: string
  members: MemberListItem[]
}) {
  return (
    <View className="gap-two px-one">
      <SectionLabel>{label}</SectionLabel>
      <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
        {members.map((member, index) => (
          <View key={member.id}>
            {index > 0 ? (
              <View className="ml-[68px] h-px bg-separator" />
            ) : null}
            <MemberRow member={member} />
          </View>
        ))}
      </View>
    </View>
  )
}

function MemberRow({ member }: { member: MemberListItem }) {
  return (
    <View
      accessibilityLabel={`${member.name}, ${member.detail}, ${member.status}`}
      className="min-h-[68px] flex-row items-center gap-three px-three py-two"
    >
      <View style={{ opacity: member.status === "offline" ? 0.5 : 1 }}>
        <Avatar
          avatarColor={member.avatarColor}
          image={member.image}
          name={member.avatarName}
          size="sm"
        />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className="text-[15px] font-semibold text-foreground"
          numberOfLines={1}
        >
          {member.name}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {member.detail}
        </Text>
      </View>
      <View className="flex-row items-center gap-two">
        <View
          className={`size-two rounded-full ${member.status === "online" ? "bg-success" : "bg-danger"}`}
        />
        <Text className="text-xs font-medium capitalize text-muted">
          {member.status}
        </Text>
      </View>
    </View>
  )
}

function MemberListSkeleton() {
  return (
    <View className="gap-three px-one">
      <Skeleton className="h-3 w-24 rounded-full" />
      <View className="gap-one rounded-lor-lg bg-surface-secondary px-three py-two">
        {[0, 1, 2, 3].map((index) => (
          <View
            className="min-h-[64px] flex-row items-center gap-three"
            key={index}
          >
            <Skeleton className="size-10 rounded-full" />
            <View className="flex-1 gap-two">
              <Skeleton className="h-3 w-32 rounded-full" />
              <Skeleton className="h-2.5 w-20 rounded-full" />
            </View>
            <Skeleton className="h-3 w-14 rounded-full" />
          </View>
        ))}
      </View>
    </View>
  )
}

export function workspaceMemberToListItem(
  member: WorkspaceMember
): MemberListItem {
  return {
    avatarColor: member.avatarColor,
    avatarName: member.name,
    detail: workspaceMemberDetail(member),
    id: member.userId,
    image: member.image,
    name: memberDisplayName(member),
    status: member.status,
  }
}

export function memberDisplayName(member: WorkspaceMember) {
  return member.displayUsername ?? member.username ?? member.name
}

export function workspaceMemberDetail(member: WorkspaceMember) {
  if (member.isBot) return "App"
  if (member.isOwner) return "Workspace owner"
  return formatRole(member.role)
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
