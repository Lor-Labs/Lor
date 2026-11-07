import { PostHog } from "posthog-node"

let client: PostHog | null | undefined

function posthogClient() {
  if (client !== undefined) return client
  const token = process.env.POSTHOG_PROJECT_TOKEN
  const host = process.env.POSTHOG_HOST
  client =
    token && host && URL.canParse(host) ? new PostHog(token, { host }) : null
  return client
}

// Server-side product analytics. distinctId is the user id, matching the web
// client's posthog.identify. Never put PII or user content in properties.
// Missing-config warnings come from initPostHogLogCapture at boot.
export function captureServerEvent(input: {
  distinctId: string
  event: string
  properties?: Record<string, string | number | boolean>
}) {
  try {
    posthogClient()?.capture(input)
  } catch (err) {
    console.warn("PostHog capture failed", err)
  }
}
