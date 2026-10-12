import { BottomSheetTextInput } from "@gorhom/bottom-sheet"
import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { router } from "expo-router"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { useUpdateAgentSession } from "@/hooks/use-agent-session"
import type { AgentSession } from "@/lib/api-types"

// Archiving a session Lor is working in stops the run, so it asks first.
// Web's archive-session-dialog copy.
export function confirmArchiveSession(
  lorRunning: boolean,
  archive: () => void
) {
  if (!lorRunning) {
    archive()
    return
  }
  Alert.alert(
    "Archive this session?",
    "Lor is still working. Archiving stops it and closes the session for everyone.",
    [
      { style: "cancel", text: "Cancel" },
      { style: "destructive", text: "Archive", onPress: archive },
    ]
  )
}

// The session screen's "…": rename, archive, unarchive. Mirrors the actions
// in web's session strip.
export function SessionActionsSheet({
  session,
  isOpen,
  onOpenChange,
  lorRunning,
}: {
  session: AgentSession
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  lorRunning: boolean
}) {
  const placeholder = useThemeColor("field-placeholder")
  const updateSession = useUpdateAgentSession()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(session.title)
  const archived = session.archivedAt !== null
  const change = {
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    sessionId: session.id,
  }

  const close = (next: boolean) => {
    if (!next) setRenaming(false)
    onOpenChange(next)
  }
  const saveTitle = () => {
    const next = title.trim()
    close(false)
    if (next && next !== session.title) {
      updateSession.mutate({ ...change, title: next })
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={close}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          snapPoints={["40%"]}
        >
          <View className="flex-row items-start gap-three px-one pb-four">
            <View className="min-w-0 flex-1 gap-px">
              <BottomSheet.Title numberOfLines={2}>
                {renaming ? "Rename session" : session.title}
              </BottomSheet.Title>
            </View>
            <BottomSheet.Close />
          </View>
          {renaming ? (
            <View className="gap-three px-one pb-six">
              <BottomSheetTextInput
                accessibilityLabel="Session title"
                autoFocus
                className="min-h-12 rounded-lor-sm border border-border bg-surface px-three text-base text-foreground"
                maxLength={200}
                onChangeText={setTitle}
                onSubmitEditing={saveTitle}
                placeholderTextColor={placeholder}
                returnKeyType="done"
                selectTextOnFocus
                value={title}
              />
              <Button isDisabled={!title.trim()} onPress={saveTitle}>
                Save
              </Button>
            </View>
          ) : (
            <View className="gap-two px-one pb-six">
              {archived ? null : (
                <ActionRow
                  detail="Your title replaces Lor's"
                  icon={PencilEdit02Icon}
                  label="Rename"
                  onPress={() => {
                    setTitle(session.title)
                    setRenaming(true)
                  }}
                />
              )}
              <ActionRow
                detail={
                  archived
                    ? "Back under the channel for its subscribers"
                    : "Leaves everyone's Channels tab"
                }
                icon={archived ? ArchiveRestoreIcon : Archive02Icon}
                label={archived ? "Unarchive" : "Archive"}
                onPress={() => {
                  triggerHaptic("soft")
                  close(false)
                  if (archived) {
                    updateSession.mutate({ ...change, archived: false })
                    return
                  }
                  confirmArchiveSession(lorRunning, () => {
                    updateSession.mutate({ ...change, archived: true })
                    // Nothing left to do here; back to where you came from.
                    if (router.canGoBack()) router.back()
                  })
                }}
              />
            </View>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function ActionRow({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  const foreground = useThemeColor("foreground")
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
        <HugeiconsIcon color={foreground} icon={icon} size={19} />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs leading-4 text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  )
}
