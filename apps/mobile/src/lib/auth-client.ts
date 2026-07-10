import { expoClient } from "@better-auth/expo/client"
import type { auth } from "@repo/auth"
import {
  adminClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import * as SecureStore from "expo-secure-store"

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080"

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: "lor",
      storagePrefix: "lor",
      storage: SecureStore,
    }),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
    adminClient(),
    usernameClient(),
    twoFactorClient(),
    inferAdditionalFields<typeof auth>(),
  ],
})
