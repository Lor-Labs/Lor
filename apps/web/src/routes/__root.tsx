import { PostHogProvider, usePostHog } from "@posthog/react"
import { authClient } from "@repo/auth/client"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { DesktopWindowFrame } from "@/components/desktop-window-frame"
import { DesktopZoomHud } from "@/components/desktop-zoom"
import { DesktopZoomProvider } from "@/context/desktop-zoom-context"

const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

function PostHogIdentity({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog()
  const { data: session, isPending } = authClient.useSession()
  const identifiedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (isPending) return

    const user = session?.user
    if (!user) {
      if (identifiedUserId.current) {
        posthog.reset()
        identifiedUserId.current = null
      }
      return
    }

    if (identifiedUserId.current && identifiedUserId.current !== user.id) {
      posthog.reset()
    }

    if (identifiedUserId.current !== user.id) {
      posthog.identify(user.id, {
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
      })
      identifiedUserId.current = user.id
    }
  }, [
    isPending,
    posthog,
    session?.user?.email,
    session?.user?.id,
    session?.user?.name,
  ])

  return <>{children}</>
}

function RootComponent() {
  const content = (
    <DesktopZoomProvider>
      <DesktopWindowFrame>
        <Outlet />
      </DesktopWindowFrame>
      <DesktopZoomHud />
    </DesktopZoomProvider>
  )

  if (!posthogProjectToken || !posthogHost) {
    if (import.meta.env.DEV) {
      const missingVariable = posthogProjectToken
        ? "NEXT_PUBLIC_POSTHOG_HOST"
        : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
      throw new Error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
      )
    }

    return content
  }

  return (
    <PostHogProvider
      apiKey={posthogProjectToken}
      options={{
        api_host: posthogHost,
        // Includes history_change pageviews for client-side navigation.
        defaults: "2026-08-30",
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      }}
    >
      <PostHogIdentity>{content}</PostHogIdentity>
    </PostHogProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
