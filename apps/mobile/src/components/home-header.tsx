import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import CancelCircleIcon from "@hugeicons/core-free-icons/CancelCircleIcon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"
import { Avatar } from "@/components/ui/avatar"
import { PressableScale } from "@/components/ui/pressable-scale"
import type { Workspace } from "@/context/workspace-context"
import { LIST_REFLOW, SWAP_ENTER, SWAP_EXIT } from "@/lib/motion"

// The Home tab's top: the workspace (opens its sheet), the two things you
// start from here, and search. It sits on the same surface as the list, and
// a hairline fades in under it once the list scrolls beneath.
export function HomeHeader({
  workspace,
  query,
  onQueryChange,
  onOpenWorkspace,
  onCreateChannel,
  onNewSession,
  scrollY,
}: {
  workspace: Workspace
  query: string
  onQueryChange: (query: string) => void
  onOpenWorkspace: () => void
  // Unset when the person can't create channels.
  onCreateChannel?: () => void
  onNewSession: () => void
  // The list's scroll offset, read on the UI thread.
  scrollY: SharedValue<number>
}) {
  const [foreground, muted, placeholder] = useThemeColor([
    "foreground",
    "muted",
    "field-placeholder",
  ])
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)
  const searching = focused || query.length > 0
  const hairline = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [0, 12], [0, 1], Extrapolation.CLAMP),
  }))

  return (
    <View className="bg-background px-four pb-three pt-one">
      <View className="min-h-11 flex-row items-center gap-two">
        <PressableScale
          accessibilityHint="Opens workspace options"
          accessibilityLabel={`${workspace.name} workspace options`}
          accessibilityRole="button"
          className="min-w-0 flex-1 flex-row items-center gap-three"
          onPress={onOpenWorkspace}
          scale={0.98}
        >
          <Avatar
            className="size-9 rounded-[10px]"
            image={workspace.logo}
            name={workspace.name}
            shape="square"
            size="xs"
          />
          <View className="min-w-0 shrink flex-row items-center gap-[6px]">
            <Text
              className="shrink text-[20px] font-bold leading-[26px] tracking-[-0.4px] text-foreground"
              numberOfLines={1}
            >
              {workspace.name}
            </Text>
            <HugeiconsIcon
              color={muted}
              icon={ArrowDown01Icon}
              size={14}
              strokeWidth={2.2}
            />
          </View>
        </PressableScale>
        {onCreateChannel ? (
          <HeaderAction
            color={foreground}
            icon={PlusSignIcon}
            label="Create channel"
            onPress={onCreateChannel}
          />
        ) : null}
        <HeaderAction
          color={foreground}
          icon={PencilEdit02Icon}
          label="New session"
          onPress={onNewSession}
        />
      </View>

      <View className="mt-two flex-row items-center gap-three">
        <Animated.View
          // min-h, not a fixed height: the field grows with larger text sizes.
          className="min-h-10 min-w-0 flex-1 flex-row items-center gap-two rounded-[12px] bg-surface-secondary px-three"
          layout={LIST_REFLOW}
        >
          <HugeiconsIcon
            color={muted}
            icon={Search01Icon}
            size={16}
            strokeWidth={2}
          />
          <TextInput
            accessibilityLabel="Search channels and messages"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 px-0 py-two text-[16px] text-foreground"
            onBlur={() => setFocused(false)}
            onChangeText={onQueryChange}
            onFocus={() => setFocused(true)}
            placeholder="Search channels and messages"
            placeholderTextColor={placeholder}
            ref={inputRef}
            returnKeyType="search"
            value={query}
          />
          {query.length > 0 ? (
            <PressableScale
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              className="size-7 items-center justify-center"
              onPress={() => onQueryChange("")}
              scale={0.88}
            >
              <HugeiconsIcon color={muted} icon={CancelCircleIcon} size={17} />
            </PressableScale>
          ) : null}
        </Animated.View>
        {/* Leaving search is one tap: it clears the text and puts the
            keyboard away. */}
        {searching ? (
          <Animated.View entering={SWAP_ENTER} exiting={SWAP_EXIT}>
            <PressableScale
              accessibilityLabel="Cancel search"
              accessibilityRole="button"
              className="min-h-10 justify-center"
              feedback="dim"
              onPress={() => {
                onQueryChange("")
                inputRef.current?.blur()
              }}
            >
              <Text className="text-[16px] text-accent">Cancel</Text>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
      <Animated.View
        className="absolute inset-x-0 bottom-0 h-px bg-separator"
        pointerEvents="none"
        style={hairline}
      />
    </View>
  )
}

function HeaderAction({
  color,
  icon,
  label,
  onPress,
}: {
  color: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      className="size-9 items-center justify-center rounded-full bg-surface-secondary"
      onPress={onPress}
      scale={0.92}
    >
      <HugeiconsIcon color={color} icon={icon} size={18} strokeWidth={1.9} />
    </PressableScale>
  )
}
