import * as Haptics from "expo-haptics"
import { Platform } from "react-native"

export type HapticFeedback =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "soft"
  | "rigid"
  | "success"
  | "warning"
  | "error"

const impactStyles = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
} as const

const androidImpactStyles = {
  light: Haptics.AndroidHaptics.Virtual_Key,
  medium: Haptics.AndroidHaptics.Context_Click,
  heavy: Haptics.AndroidHaptics.Long_Press,
  soft: Haptics.AndroidHaptics.Segment_Frequent_Tick,
  rigid: Haptics.AndroidHaptics.Gesture_End,
} as const

const notificationStyles = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
} as const

const androidNotificationStyles = {
  success: Haptics.AndroidHaptics.Confirm,
  warning: Haptics.AndroidHaptics.Context_Click,
  error: Haptics.AndroidHaptics.Reject,
} as const

export function ignoreUnavailableHaptics(effect: Promise<void>) {
  void effect.catch(() => undefined)
}

export function triggerHaptic(feedback: HapticFeedback = "light") {
  if (feedback === "selection") {
    ignoreUnavailableHaptics(
      Platform.OS === "android"
        ? Haptics.performAndroidHapticsAsync(
            Haptics.AndroidHaptics.Segment_Tick
          )
        : Haptics.selectionAsync()
    )
    return
  }

  if (feedback in notificationStyles) {
    const semanticFeedback = feedback as keyof typeof notificationStyles
    ignoreUnavailableHaptics(
      Platform.OS === "android"
        ? Haptics.performAndroidHapticsAsync(
            androidNotificationStyles[semanticFeedback]
          )
        : Haptics.notificationAsync(notificationStyles[semanticFeedback])
    )
    return
  }

  const impactFeedback = feedback as keyof typeof impactStyles
  ignoreUnavailableHaptics(
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(androidImpactStyles[impactFeedback])
      : Haptics.impactAsync(impactStyles[impactFeedback])
  )
}

export function triggerToggleHaptic(isSelected: boolean) {
  ignoreUnavailableHaptics(
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(
          isSelected
            ? Haptics.AndroidHaptics.Toggle_On
            : Haptics.AndroidHaptics.Toggle_Off
        )
      : Haptics.selectionAsync()
  )
}
