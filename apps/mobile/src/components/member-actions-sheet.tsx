import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import UserIcon from "@hugeicons/core-free-icons/UserIcon"
import UserRemove01Icon from "@hugeicons/core-free-icons/UserRemove01Icon"
import UserShield01Icon from "@hugeicons/core-free-icons/UserShield01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import type { AssignableWorkspaceRole } from "@repo/auth/permissions"
import { formatWorkspaceRole } from "@repo/auth/permissions"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Alert, Pressable, Text, View } from "react-native"
import type { MemberListItem } from "@/components/member-list-sheet"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"

const roleActionCopy: Record<
  AssignableWorkspaceRole,
  { detail: string; icon: IconSvgElement }
> = {
  admin: {
    detail: "Can manage channels, members, and settings",
    icon: UserShield01Icon,
  },
  member: {
    detail: "Standard workspace access",
    icon: UserIcon,
  },
}

export function MemberActionsSheet({
  canKick,
  isBusy,
  member,
  onChangeRole,
  onKick,
  onOpenChange,
  roleOptions,
}: {
  canKick: boolean
  isBusy: boolean
  member: MemberListItem | null
  onChangeRole: (userId: string, role: AssignableWorkspaceRole) => void
  onKick: (userId: string) => void
  onOpenChange: (isOpen: boolean) => void
  roleOptions: AssignableWorkspaceRole[]
}) {
  const confirmKick = (target: MemberListItem) => {
    Alert.alert(
      "Kick member?",
      `Remove ${target.name} from this workspace? They can rejoin if invited again.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Kick member",
          onPress: () => {
            onOpenChange(false)
            onKick(target.id)
          },
        },
      ]
    )
  }

  return (
    <BottomSheet isOpen={member !== null} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content enableDynamicSizing={false} snapPoints={["42%"]}>
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {member ? (
              <>
                <View className="flex-row items-start gap-three px-one">
                  <Avatar
                    avatarColor={member.avatarColor}
                    image={member.image}
                    name={member.avatarName}
                    size="sm"
                  />
                  <View className="min-w-0 flex-1 gap-px">
                    <BottomSheet.Title>{member.name}</BottomSheet.Title>
                    <BottomSheet.Description>
                      {member.detail}
                    </BottomSheet.Description>
                  </View>
                  <BottomSheet.Close />
                </View>

                <View className="gap-two px-one">
                  {roleOptions.map((role) => (
                    <ActionRow
                      detail={roleActionCopy[role].detail}
                      disabled={isBusy}
                      icon={roleActionCopy[role].icon}
                      key={role}
                      label={`Make ${formatWorkspaceRole(role).toLowerCase()}`}
                      onPress={() => {
                        triggerHaptic("soft")
                        onOpenChange(false)
                        onChangeRole(member.id, role)
                      }}
                    />
                  ))}
                  {canKick ? (
                    <ActionRow
                      destructive
                      detail="Remove them from this workspace"
                      disabled={isBusy}
                      icon={UserRemove01Icon}
                      label="Kick from workspace"
                      onPress={() => {
                        triggerHaptic("soft")
                        confirmKick(member)
                      }}
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function ActionRow({
  destructive = false,
  detail,
  disabled,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean
  detail: string
  disabled?: boolean
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  const [foreground, danger] = useThemeColor(["foreground", "danger"])
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className={`min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary ${
        disabled ? "opacity-40" : ""
      }`}
      disabled={disabled}
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
        <HugeiconsIcon
          color={destructive ? danger : foreground}
          icon={icon}
          size={19}
        />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className={`text-[15px] font-semibold ${destructive ? "text-danger" : "text-foreground"}`}
        >
          {label}
        </Text>
        <Text className="text-xs leading-4 text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  )
}
