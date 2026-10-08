import { authClient } from "@repo/auth/client"
import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { OfflineScreen } from "@/components/offline-screen"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { Sidebar } from "@/components/sidebar/index"
import { MobileSidebarProvider } from "@/context/mobile-sidebar-context"
import { SocketProvider } from "@/context/socket-context"
import { UnreadProvider } from "@/context/unread-context"
import { VoiceCallProvider } from "@/context/voice-call-context"
import { useBrowserNotifications } from "@/hooks/use-browser-notifications"
import { useConnectivity } from "@/hooks/use-connectivity"
import { useUpdateCheck } from "@/hooks/use-update-check"

// v0.1.2
function BrowserNotifications() {
  useBrowserNotifications()
  return null
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

function UpdateBanner() {
  const { updateAvailable, isInstalling, refresh } = useUpdateCheck()
  if (!updateAvailable) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium text-foreground">
          {isInstalling ? "Installing update..." : "A new version is available"}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={isInstalling}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isInstalling ? "Installing..." : isTauri ? "Update" : "Refresh"}
        </button>
      </div>
    </div>
  )
}

const LAST_PATH_KEY = "lor:last-path"

// Settings dialogs are URL-driven so they survive refresh and deep-link
// (e.g. the GitHub setup redirect reopens GitHub's connector detail):
// ?settings=user|workspace&tab=<section>[&connector=<id>].
type SettingsSearch = {
  settings?: "user" | "workspace"
  tab?: string
  mcpServerId?: string
  connector?: string
}

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    settings:
      search.settings === "user" || search.settings === "workspace"
        ? search.settings
        : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    mcpServerId:
      typeof search.mcpServerId === "string" ? search.mcpServerId : undefined,
    connector:
      typeof search.connector === "string" ? search.connector : undefined,
  }),
})

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending, refetch } = authClient.useSession()
  // Without a connection the session request fails and looks exactly like a
  // signed-out user, so the desktop app would drop to the sign-in form. Hold
  // the redirect until the probe answers, and show the offline screen instead.
  const { status: connectivity } = useConnectivity()
  const isOffline = connectivity === "offline"
  const connectivityUnknown = connectivity === "unknown"

  // better-auth refetches the session on the window's own `online` event; this
  // covers the case where the probe recovers without one firing. Declared above
  // the redirect effect so the ref is set before that effect reads it in the
  // same commit; the state is what re-runs the redirect once this settles.
  const wasOffline = useRef(false)
  const isRecovering = useRef(false)
  const [recovering, setRecovering] = useState(false)
  useEffect(() => {
    if (isOffline) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    isRecovering.current = true
    setRecovering(true)
    void refetch().finally(() => {
      isRecovering.current = false
      setRecovering(false)
    })
  }, [isOffline, refetch])

  useEffect(() => {
    if (isPending || session || isOffline || connectivityUnknown) return
    // The session is still absent from the fetch that failed while offline,
    // which is indistinguishable from signed out — wait for the refetch.
    if (recovering || isRecovering.current) return
    navigate({
      to: "/login",
      search: {
        redirect: location.href === "/" ? undefined : location.href,
      },
    })
  }, [
    isPending,
    session,
    isOffline,
    connectivityUnknown,
    recovering,
    navigate,
    location.href,
  ])

  useEffect(() => {
    if (location.pathname !== "/") {
      localStorage.setItem(LAST_PATH_KEY, location.pathname)
    }
  }, [location.pathname])

  // Offline wins over the session fetch: with no connection it can only fail,
  // so waiting on it would leave a spinner where the reason belongs.
  if (!session && isOffline) {
    return <OfflineScreen />
  }

  // `recovering` only gates the signed-out case: a signed-in user reconnecting
  // must not have the whole app replaced by a spinner.
  if (isPending || (!session && (recovering || connectivityUnknown))) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return isOffline ? <OfflineScreen /> : null
  }

  return (
    <SocketProvider enabled={!!session}>
      <UnreadProvider>
        <MobileSidebarProvider>
          <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <UpdateBanner />
            <VoiceCallProvider>
              <Sidebar>
                {/* Inside the sidebar tree so notification clicks can open
                    the right panel. */}
                <BrowserNotifications />
                <Outlet />
              </Sidebar>
            </VoiceCallProvider>
            <SettingsDialog />
          </div>
        </MobileSidebarProvider>
      </UnreadProvider>
    </SocketProvider>
  )
}
