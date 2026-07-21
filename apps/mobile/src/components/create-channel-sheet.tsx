import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import HashIcon from "@hugeicons/core-free-icons/HashIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { Button } from "@/components/ui/button"
import { SectionLabel } from "@/components/ui/section-label"
import { api, responseMessage } from "@/lib/api"
import type { Channel, ChannelCategory } from "@/lib/api-types"

export function normalizeChannelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

export function CreateChannelSheet({
  categories,
  isOpen,
  onCreated,
  onOpenChange,
  workspaceName,
  workspaceSlug,
}: {
  categories: ChannelCategory[]
  isOpen: boolean
  onCreated: (channel: Channel) => void
  onOpenChange: (isOpen: boolean) => void
  workspaceName: string
  workspaceSlug: string
}) {
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [foreground, accent] = useThemeColor(["foreground", "accent"])

  useEffect(() => {
    if (!isOpen) return
    setName("")
    setParentId(null)
    setError(null)
  }, [isOpen])

  const normalizedName = normalizeChannelName(name)

  const createChannel = async () => {
    if (!normalizedName || isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels.$post(
        {
          param: { workspaceSlug },
          json: {
            name: normalizedName,
            type: "text",
            ...(parentId ? { parentId } : {}),
          },
        }
      )
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not create channel")
        )
      }
      const channel = await response.json()
      onOpenChange(false)
      onCreated(channel)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create channel"
      )
    } finally {
      setIsCreating(false)
    }
  }

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
          snapPoints={["68%", "92%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-three px-one">
              <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                <HugeiconsIcon color={foreground} icon={HashIcon} size={20} />
              </View>
              <View className="min-w-0 flex-1 gap-px">
                <BottomSheet.Title>Create channel</BottomSheet.Title>
                <BottomSheet.Description>
                  Add a new text channel to {workspaceName}.
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>

            <View className="gap-two px-one">
              <Text className="text-sm font-semibold text-foreground">
                Name
              </Text>
              <BottomSheetTextInput
                accessibilityLabel="Channel name"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-12 rounded-lor-sm border border-border bg-surface px-three text-base text-foreground"
                maxLength={100}
                onChangeText={setName}
                placeholder="general"
                placeholderTextColor="#737373"
                value={name}
              />
              {normalizedName && normalizedName !== name.trim() ? (
                <Text className="text-xs text-muted">
                  Will be created as #{normalizedName}
                </Text>
              ) : null}
            </View>

            {categories.length > 0 ? (
              <View className="gap-two px-one">
                <SectionLabel>Category</SectionLabel>
                <View className="overflow-hidden rounded-lor-sm bg-surface-secondary">
                  <CategoryRow
                    accent={accent}
                    isLast={categories.length === 0}
                    isSelected={parentId === null}
                    label="No category"
                    onPress={() => setParentId(null)}
                  />
                  {categories.map((category, index) => (
                    <CategoryRow
                      accent={accent}
                      isLast={index === categories.length - 1}
                      isSelected={parentId === category.id}
                      key={category.id}
                      label={category.name ?? "Category"}
                      onPress={() => setParentId(category.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {error ? (
              <Text className="px-one text-sm font-medium text-danger">
                {error}
              </Text>
            ) : null}

            <View className="px-one">
              <Button
                isDisabled={isCreating || !normalizedName}
                onPress={() => void createChannel()}
              >
                {isCreating ? "Creating…" : "Create channel"}
              </Button>
            </View>
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function CategoryRow({
  accent,
  isLast,
  isSelected,
  label,
  onPress,
}: {
  accent: string
  isLast: boolean
  isSelected: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      className={`min-h-12 flex-row items-center gap-three px-three active:bg-surface-tertiary ${
        isLast ? "" : "border-b border-separator"
      }`}
      onPress={onPress}
    >
      <Text className="min-w-0 flex-1 text-[15px] text-foreground">
        {label}
      </Text>
      {isSelected ? (
        <SymbolView
          name={{ ios: "checkmark", android: "check", web: "check" }}
          size={16}
          tintColor={accent}
        />
      ) : null}
    </Pressable>
  )
}
