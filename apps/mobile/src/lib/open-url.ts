import * as WebBrowser from "expo-web-browser"

// openBrowserAsync rejects (e.g. when another browser sheet is already
// presented) — swallow it instead of leaving an unhandled rejection.
export function openExternalUrl(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {})
}
