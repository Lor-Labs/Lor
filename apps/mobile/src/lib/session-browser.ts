import * as WebBrowser from "expo-web-browser"
import { Alert } from "react-native"
import { api, responseMessage } from "@/lib/api"

// A code session's browser on the phone (reference/planned/sandbox-browser-runbook.md
// §4): noVNC's own page from the sandbox in an in-app browser. Driving takes
// control first and hands it back when the browser closes. iOS reports the
// close; elsewhere the sandbox's gateway hands control back 2 minutes after
// the view goes away.
export async function openSessionBrowser(sessionId: string, drive: boolean) {
  try {
    if (drive) {
      const taken = await api.v1.sessions[":sessionId"].browser.control.$post({
        param: { sessionId },
        json: { take: true },
      })
      if (!taken.ok) {
        throw new Error(await responseMessage(taken, "Couldn't take control"))
      }
    }
    const res = await api.v1.sessions[":sessionId"].browser.$post({
      param: { sessionId },
    })
    if (!res.ok) {
      throw new Error(await responseMessage(res, "The browser didn't start"))
    }
    const view = await res.json()
    if (view.status === "unavailable") {
      Alert.alert(
        "No browser in this session",
        "This session's sandbox predates the browser. Start a new session to use it."
      )
      return
    }
    const result = await WebBrowser.openBrowserAsync(view.pageUrl)
    // iOS: "cancel" when the person closes it, "dismiss" when code does.
    if (drive && (result.type === "cancel" || result.type === "dismiss")) {
      await api.v1.sessions[":sessionId"].browser.control
        .$post({ param: { sessionId }, json: { take: false } })
        .catch(() => {})
    }
  } catch (err) {
    Alert.alert(
      "Couldn't open the browser",
      err instanceof Error ? err.message : "Please try again in a moment."
    )
  }
}
