import "@repo/env/server-fields"
import { initErrorReporting, initPostHogLogCapture } from "@repo/logger"

initErrorReporting("api")

export const posthogLogCapture = initPostHogLogCapture({
  serviceName: "api",
  projectToken: process.env.POSTHOG_PROJECT_TOKEN,
  host: process.env.POSTHOG_HOST,
})
