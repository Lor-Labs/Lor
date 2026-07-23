import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { api } from "@/lib/api"

let registeredToken: string | null = null

async function getPushRegistration() {
  const platform = Platform.OS
  if (!Device.isDevice) return null
  if (platform !== "ios" && platform !== "android") return null

  if (platform === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Messages",
      importance: Notifications.AndroidImportance.MAX,
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  const status = existing.granted
    ? "granted"
    : (await Notifications.requestPermissionsAsync()).status
  if (status !== "granted") return null

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  if (typeof projectId !== "string" || !projectId) return null

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  return { token, platform }
}

export async function registerPushToken() {
  const registration = await getPushRegistration()
  if (!registration) return
  const response = await api.v1["push-tokens"].$post({ json: registration })
  if (response.ok) registeredToken = registration.token
}

// Must run before signOut so the request still carries a valid session.
export async function unregisterPushToken() {
  const token = registeredToken
  registeredToken = null
  if (!token) return
  await api.v1["push-tokens"].$delete({ json: { token } })
}
