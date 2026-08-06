import { Alert } from "react-native"

export function confirmDiscard(onDiscard: () => void) {
  Alert.alert("Discard changes?", "Your unsaved changes will be lost.", [
    { style: "cancel", text: "Keep editing" },
    { style: "destructive", text: "Discard", onPress: onDiscard },
  ])
}
