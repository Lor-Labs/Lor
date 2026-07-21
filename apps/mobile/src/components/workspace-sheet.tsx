import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { SectionLabel } from "@/components/ui/section-label"
import type { Workspace } from "@/context/workspace-context"

export function WorkspaceSheet({
  channelCount,
  isOpen,
  onAddWorkspace,
  onInvite,
  onOpenChange,
  onSelectWorkspace,
  workspace,
  workspaces,
}: {
  channelCount: number | null
  isOpen: boolean
  onAddWorkspace: () => void
  onInvite: () => void
  onOpenChange: (isOpen: boolean) => void
  onSelectWorkspace: (workspaceId: string) => void
  workspace: Workspace
  workspaces: Workspace[]
}) {
  const [foreground, accent] = useThemeColor(["foreground", "accent"])
  const otherWorkspaces = workspaces.filter((item) => item.id !== workspace.id)

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          snapPoints={["55%", "85%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-three px-one">
              <Avatar
                image={workspace.logo}
                name={workspace.name}
                shape="square"
                size="md"
              />
              <View className="min-w-0 flex-1 gap-px">
                <BottomSheet.Title>{workspace.name}</BottomSheet.Title>
                <BottomSheet.Description>
                  {channelCount === null
                    ? "Workspace"
                    : `${channelCount} ${channelCount === 1 ? "channel" : "channels"}`}
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>

            <View className="gap-three px-one">
              <Pressable
                accessibilityHint="Opens invite link options"
                accessibilityLabel="Invite people"
                accessibilityRole="button"
                className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
                onPress={onInvite}
              >
                <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
                  <HugeiconsIcon
                    color={foreground}
                    icon={UserAdd01Icon}
                    size={19}
                  />
                </View>
                <View className="min-w-0 flex-1 gap-px">
                  <Text className="text-[15px] font-semibold text-foreground">
                    Invite people
                  </Text>
                  <Text className="text-xs leading-4 text-muted">
                    Share an invite link to bring in your team
                  </Text>
                </View>
                <SymbolView
                  name={{
                    ios: "chevron.right",
                    android: "chevron_right",
                    web: "chevron_right",
                  }}
                  size={17}
                  tintColor={foreground}
                />
              </Pressable>
            </View>

            <View className="gap-three px-one">
              <SectionLabel>
                {otherWorkspaces.length > 0 ? "Switch workspace" : "Workspaces"}
              </SectionLabel>
              <View className="overflow-hidden rounded-lor-sm bg-surface-secondary">
                {workspaces.map((item, index) => {
                  const isActive = item.id === workspace.id
                  return (
                    <Pressable
                      accessibilityLabel={
                        isActive
                          ? `Current workspace ${item.name}`
                          : `Switch to ${item.name}`
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      className={`min-h-14 flex-row items-center gap-three px-three active:bg-surface-tertiary ${
                        index === workspaces.length - 1
                          ? ""
                          : "border-b border-separator"
                      }`}
                      key={item.id}
                      onPress={() => {
                        if (!isActive) onSelectWorkspace(item.id)
                      }}
                    >
                      <Avatar
                        image={item.logo}
                        name={item.name}
                        shape="square"
                        size="xs"
                      />
                      <Text
                        className="min-w-0 flex-1 text-[15px] font-medium text-foreground"
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {isActive ? (
                        <SymbolView
                          name={{
                            ios: "checkmark",
                            android: "check",
                            web: "check",
                          }}
                          size={16}
                          tintColor={accent}
                        />
                      ) : null}
                    </Pressable>
                  )
                })}
              </View>
              <Pressable
                accessibilityLabel="Create or join a workspace"
                accessibilityRole="button"
                className="min-h-12 flex-row items-center gap-three rounded-lor-sm px-three active:bg-surface-secondary"
                onPress={onAddWorkspace}
              >
                <View className="size-7 items-center justify-center rounded-lor-sm bg-surface-secondary">
                  <HugeiconsIcon
                    color={foreground}
                    icon={PlusSignIcon}
                    size={16}
                  />
                </View>
                <Text className="text-[15px] font-medium text-muted">
                  Create or join a workspace
                </Text>
              </Pressable>
            </View>
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
