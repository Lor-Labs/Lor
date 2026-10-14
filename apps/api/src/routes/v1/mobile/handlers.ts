import { env } from "@repo/env/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetMobileVersionRoute } from "@/routes/v1/mobile/routes"

// TestFlight's public join link; it opens Lor's page in the TestFlight app.
// Served from here, not the app, so a move to the App Store reaches old apps.
const UPDATE_URL = "https://testflight.apple.com/join/uJfqWwxJ"

export const getMobileVersion: AppRouteHandler<GetMobileVersionRoute> = (c) =>
  c.json(
    {
      minimumVersion: env.MOBILE_MIN_VERSION ?? null,
      updateUrl: UPDATE_URL,
    },
    HttpStatusCodes.OK
  )
