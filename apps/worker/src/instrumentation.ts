import "@repo/env/server-fields"
import { initErrorReporting, initPostHogLogCapture } from "@repo/logger"

initErrorReporting("worker")

export const posthogLogCapture = initPostHogLogCapture({
  serviceName: "worker",
  projectToken: process.env.POSTHOG_PROJECT_TOKEN,
  host: process.env.POSTHOG_HOST,
})
