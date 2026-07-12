import type { ReactNode } from "react"
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
import { Radius, Spacing } from "@/constants/theme"
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
  const theme = useTheme()
  const initial = name.trim().charAt(0).toUpperCase() || "?"

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.32),
          backgroundColor: merlin ? theme.merlin : theme.accentMuted,
        },
      ]}
    >
      {image ? (
        <Image source={{ uri: image }} style={styles.avatarImage} />
      ) : (
        <Text
          style={[
            styles.avatarInitial,
            { color: merlin ? theme.merlinMuted : theme.accent },
          ]}
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
  style,
  disabled = false,
  accessibilityLabel,
}: {
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  accessibilityLabel?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && !disabled && { backgroundColor: theme.pressed },
        disabled && styles.disabled,
      ]}
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
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && !disabled && { backgroundColor: theme.pressed },
        disabled && styles.disabled,
      ]}
    >
      <Image source={icon} style={[styles.icon, { tintColor: theme.text }]} />
    </Pressable>
  )
}

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return (
    <View
      style={[styles.skeleton, { backgroundColor: theme.divider }, style]}
    />
  )
}

export function StatePanel({
  title,
  detail,
  action,
  style,
}: {
  title: string
  detail: string
  action?: { label: string; onPress: () => void }
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  return (
    <View style={[styles.statePanel, style]}>
      <View
        style={[styles.stateMark, { backgroundColor: theme.accentMuted }]}
      />
      <Text style={[styles.stateTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.stateDetail, { color: theme.textSecondary }]}>
        {detail}
      </Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.stateAction,
            { backgroundColor: theme.accent },
            pressed && styles.actionPressed,
          ]}
        >
          <Text
            style={[styles.stateActionText, { color: theme.accentForeground }]}
          >
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

export function InlineSpinner() {
  const theme = useTheme()
  return <ActivityIndicator color={theme.accent} />
}

export function SectionLabel({ children }: { children: string }) {
  const theme = useTheme()
  return (
    <Text style={[styles.sectionLabel, { color: theme.textTertiary }]}>
      {children}
    </Text>
  )
}

export const textStyles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
} satisfies Record<string, TextStyle>)

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 14, fontWeight: "700" },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { width: 18, height: 18, resizeMode: "contain" },
  disabled: { opacity: 0.45 },
  skeleton: { borderRadius: Radius.small },
  statePanel: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.seven,
    paddingVertical: Spacing.eight,
  },
  stateMark: {
    width: 34,
    height: 34,
    borderRadius: Radius.medium,
    marginBottom: Spacing.four,
  },
  stateTitle: { ...textStyles.heading, textAlign: "center" },
  stateDetail: {
    ...textStyles.body,
    marginTop: Spacing.two,
    textAlign: "center",
  },
  stateAction: {
    borderRadius: Radius.medium,
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  stateActionText: { ...textStyles.bodyMedium },
  actionPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  sectionLabel: {
    ...textStyles.micro,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
})
