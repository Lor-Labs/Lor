import * as WebBrowser from "expo-web-browser"
import { Appearance } from "react-native"
import { Colors } from "@/constants/theme"

function browserOptions(): WebBrowser.WebBrowserOpenOptions {
  const palette =
    Appearance.getColorScheme() === "dark" ? Colors.dark : Colors.light

  return {
    controlsColor: palette.text,
    createTask: false,
    dismissButtonStyle: "close",
    enableBarCollapsing: true,
    enableDefaultShareMenuItem: true,
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    showTitle: true,
    toolbarColor: palette.surface,
  }
}

// openBrowserAsync rejects (e.g. when another browser sheet is already
// presented) — swallow it instead of leaving an unhandled rejection.
export function openExternalUrl(url: string) {
  WebBrowser.openBrowserAsync(url, browserOptions()).catch(() => {})
}
