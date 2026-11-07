import Constants from "expo-constants"
import type { PropsWithChildren } from "react"
import { useEffect, useRef } from "react"
import PostHog, { PostHogProvider as PostHogReactNativeProvider } from "posthog-react-native"
import { authClient } from "@/lib/auth-client"

const extra = Constants.expoConfig?.extra
const projectToken =
  typeof extra?.posthogProjectToken === "string"
    ? extra.posthogProjectToken
    : undefined
const host = typeof extra?.posthogHost === "string" ? extra.posthogHost : undefined
const logEnvironment =
  extra?.appVariant === "development" ? "development" : "production"
const logServiceVersion = Constants.expoConfig?.version
const isPostHogConfigured = Boolean(projectToken && host)

if (!isPostHogConfigured && __DEV__) {
  const missingVariable = projectToken
    ? "EXPO_PUBLIC_POSTHOG_HOST"
    : "EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN"

  console.error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
  )
}

export const posthog =
  projectToken && host
    ? new PostHog(projectToken, {
        host,
        captureAppLifecycleEvents: true,
        debug: __DEV__,
        preloadFeatureFlags: true,
        logs: {
          serviceName: "lor-mobile",
          environment: logEnvironment,
          ...(logServiceVersion ? { serviceVersion: logServiceVersion } : {}),
        },
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
          },
        },
      })
    : undefined

export const posthogLogger = posthog?.logger

function PostHogIdentity() {
  const { data: session, isPending } = authClient.useSession()
  const identifiedUserId = useRef<string | null>(null)
  const user = session?.user

  useEffect(() => {
    if (!posthog || isPending) return

    if (!user) {
      if (identifiedUserId.current) posthog.reset()
      identifiedUserId.current = null
      return
    }

    if (identifiedUserId.current === user.id) return

    if (identifiedUserId.current) posthog.reset()

    posthog.identify(user.id, {
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
    })
    identifiedUserId.current = user.id
  }, [isPending, user])

  return null
}

export function PostHogProvider({ children }: PropsWithChildren) {
  if (!posthog) return children

  return (
    <PostHogReactNativeProvider client={posthog}>
      <PostHogIdentity />
      {children}
    </PostHogReactNativeProvider>
  )
}
