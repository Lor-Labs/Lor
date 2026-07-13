import type { ReactNode } from "react"
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Pressable,
  Text,
  View,
} from "react-native"
import { useTheme } from "@/hooks/use-theme"

export function Avatar({
  name,
  image,
  size = 38,
  merlin = false,
}: {
  name: string
  image?: string | null
  size?: number
  merlin?: boolean
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?"

  return (
    <View
      className={
        merlin
          ? "items-center justify-center overflow-hidden rounded-lor-md bg-lor-merlin dark:bg-lor-merlin-dark"
          : "items-center justify-center overflow-hidden rounded-lor-md bg-lor-accent-muted dark:bg-lor-accent-muted-dark"
      }
      style={{ height: size, width: size }}
    >
      {image ? (
        <Image className="h-full w-full" source={{ uri: image }} />
      ) : (
        <Text
          className={
            merlin
              ? "text-sm font-bold text-lor-merlin-muted dark:text-lor-merlin-muted-dark"
              : "text-sm font-bold text-lor-accent dark:text-lor-accent-dark"
          }
        >
          {initial}
        </Text>
      )}
    </View>
  )
}

export function PressableSurface({
  children,
  onPress,
  className,
  disabled = false,
  accessibilityLabel,
}: {
  children: ReactNode
  onPress?: () => void
  className?: string
  disabled?: boolean
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      className={`${className ?? ""} active:bg-lor-pressed dark:active:bg-lor-pressed-dark disabled:opacity-45`}
      disabled={disabled}
      onPress={onPress}
    >
      {children}
    </Pressable>
  )
}

export function IconButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string
  icon: ImageSourcePropType
  onPress: () => void
  disabled?: boolean
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      className="h-9 w-9 items-center justify-center rounded-lor-md active:bg-lor-pressed dark:active:bg-lor-pressed-dark disabled:opacity-45"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
    >
      <Image
        className="h-[18px] w-[18px]"
        source={icon}
        tintColor={theme.text}
      />
    </Pressable>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <View
      className={`rounded-lor-sm bg-lor-divider dark:bg-lor-divider-dark ${className ?? ""}`}
    />
  )
}

export function StatePanel({
  title,
  detail,
  action,
  className,
}: {
  title: string
  detail: string
  action?: { label: string; onPress: () => void }
  className?: string
}) {
  return (
    <View
      className={`items-center justify-center px-seven py-eight ${className ?? ""}`}
    >
      <View className="mb-four h-[34px] w-[34px] rounded-lor-md bg-lor-accent-muted dark:bg-lor-accent-muted-dark" />
      <Text className="text-center text-lg font-bold tracking-[-0.2px] text-lor-text dark:text-lor-text-dark">
        {title}
      </Text>
      <Text className="mt-two text-center text-[15px] leading-[21px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
        {detail}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          className="mt-five rounded-lor-md bg-lor-accent px-four py-three active:scale-[0.98] active:opacity-80 dark:bg-lor-accent-dark"
          onPress={action.onPress}
        >
          <Text className="text-[15px] font-semibold leading-[21px] text-lor-accent-fg dark:text-lor-accent-fg-dark">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function InlineSpinner() {
  const theme = useTheme()
  return <ActivityIndicator color={theme.accent} />
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.8px] text-lor-text-tertiary dark:text-lor-text-tertiary-dark">
      {children}
    </Text>
  )
}
