import {
  PostHogErrorBoundary,
  PostHogProvider,
  usePostHog,
} from "@posthog/react"
import { authClient } from "@repo/auth/client"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { DesktopWindowFrame } from "@/components/desktop-window-frame"
import { DesktopZoomHud } from "@/components/desktop-zoom"
import { DesktopZoomProvider } from "@/context/desktop-zoom-context"

const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

function RootComponent() {
  if (!posthogProjectToken || !posthogHost) {
    if (import.meta.env.DEV) {
      const missingVariable = !posthogProjectToken
        ? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
        : "NEXT_PUBLIC_POSTHOG_HOST"
      throw new Error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
      )
    }

    return <AppShell />
  }

  return (
    <PostHogProvider
      apiKey={posthogProjectToken}
      options={{
        api_host: posthogHost,
        capture_exceptions: true,
        debug: import.meta.env.DEV,
        logs: {
          serviceName: "lor-web",
          environment: import.meta.env.MODE,
        },
      }}
    >
      <PostHogErrorBoundary>
        <PostHogIdentity />
        <AppShell />
      </PostHogErrorBoundary>
    </PostHogProvider>
  )
}

function PostHogIdentity() {
  const { data: session } = authClient.useSession()
  const posthog = usePostHog()
  const identifiedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!posthog) return

    const user = session?.user
    if (!user) {
      if (identifiedUserId.current) {
        posthog.reset()
        identifiedUserId.current = null
      }
      return
    }

    if (identifiedUserId.current === user.id) return

    if (identifiedUserId.current) posthog.reset()

    posthog.identify(user.id, {
      email: user.email,
      name: user.name,
    })
    identifiedUserId.current = user.id
  }, [posthog, session])

  return null
}

function AppShell() {
  return (
    <DesktopZoomProvider>
      <DesktopWindowFrame>
        <Outlet />
      </DesktopWindowFrame>
      <DesktopZoomHud />
    </DesktopZoomProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
