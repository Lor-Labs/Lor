import { Alert, Linking } from "react-native"

// Let the OS use the default browser; an in-app browser forces Safari on iOS.
export function openExternalUrl(url: string) {
  void Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open the link", "Please try again in a moment.")
  })
}
