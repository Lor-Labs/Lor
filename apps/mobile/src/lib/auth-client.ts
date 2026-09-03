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
import { APP_SCHEME } from "./app-variant"
import { env } from "./env"
import { ac, admin, member, owner } from "./permissions"

export const API_URL = env.EXPO_PUBLIC_API_URL

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: APP_SCHEME,
      storagePrefix: "lor",
      cookiePrefix: "lor",
      storage: SecureStore,
    }),
    organizationClient({
      ac,
      roles: {
        owner,
        admin,
        member,
      },
      schema: inferOrgAdditionalFields<typeof auth>(),
      // Exposes listRoles so approval cards can gate their buttons with real
      // custom-role grants (the server enforces regardless).
      dynamicAccessControl: { enabled: true },
    }),
    adminClient(),
    usernameClient(),
    twoFactorClient(),
    inferAdditionalFields<typeof auth>(),
  ],
})
