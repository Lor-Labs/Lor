import { env } from "@repo/env/client"
import {
  adminClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { auth } from "./auth.js"
import { ac, admin, member, owner } from "./permissions"
import { appFetch } from "./tauri-fetch"

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  fetchOptions: { customFetchImpl: appFetch },
  plugins: [
    organizationClient({
      ac,
      roles: {
        owner,
        admin,
        member,
      },
      schema: inferOrgAdditionalFields<typeof auth>(),
      dynamicAccessControl: { enabled: true },
    }),
    adminClient(),
    twoFactorClient(),
    inferAdditionalFields<typeof auth>(), //for inferring user and session additional fields
  ],
})
