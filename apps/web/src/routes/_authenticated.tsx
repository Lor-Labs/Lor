import { authClient } from "@repo/auth/client"
import { useQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { Sidebar } from "@/components/sidebar/index"
import { MobileSidebarProvider } from "@/context/mobile-sidebar-context"
import { SocketProvider } from "@/context/socket-context"
import { UnreadProvider } from "@/context/unread-context"
import { useBrowserNotifications } from "@/hooks/use-browser-notifications"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { clearPendingInvite, readPendingInvite } from "@/lib/pending-invite"

const MIN_USERNAME_LENGTH = 3

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
// (e.g. the GitHub setup redirect reopens the Integrations tab):
// ?settings=user|workspace&tab=<section>.
type SettingsSearch = {
  settings?: "user" | "workspace"
  tab?: string
}

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    settings:
      search.settings === "user" || search.settings === "workspace"
        ? search.settings
        : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
})

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending } = authClient.useSession()
  // Consume any invite stashed by /invite/$code exactly once, so onboarding
  // can pre-fill the join step. Cleared immediately — it only needs to survive
  // the redirect, and lives in-memory for the dialog's lifetime after that.
  const [pendingInvite] = useState(() => {
    const code = readPendingInvite()
    if (code) clearPendingInvite()
    return code
  })
  const [onboardingDone, setOnboardingDone] = useState(false)

  useEffect(() => {
    if (!isPending && !session) {
      navigate({
        to: "/login",
        search: {
          redirect: location.href === "/" ? undefined : location.href,
        },
      })
    }
  }, [isPending, session, navigate, location.href])

  useEffect(() => {
    if (location.pathname !== "/") {
      localStorage.setItem(LAST_PATH_KEY, location.pathname)
    }
  }, [location.pathname])

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      return res.data
    },
    enabled: !!session,
  })

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  // Show onboarding when the account isn't set up yet: either no workspace, or
  // no username (invited users join a workspace without ever being prompted for
  // one). The onboardingCompleted flag guards existing users whose flag
  // defaulted to false. The username step closes the dialog via onComplete once
  // an already-in-a-workspace user picks one.
  const hasUsername =
    !!session.user.username &&
    session.user.username.length >= MIN_USERNAME_LENGTH
  const hasWorkspace = (workspaces?.length ?? 0) > 0
  const showOnboarding =
    session.user.onboardingCompleted === false &&
    workspaces != null &&
    (workspaces.length === 0 || !hasUsername)

  return (
    <SocketProvider enabled={!!session}>
      <UnreadProvider>
        <BrowserNotifications />
        <UpdateBanner />
        <MobileSidebarProvider>
          <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <Sidebar>
              <Outlet />
            </Sidebar>
            <OnboardingDialog
              open={showOnboarding && !onboardingDone}
              inviteCode={pendingInvite}
              hasWorkspace={hasWorkspace}
              onComplete={() => setOnboardingDone(true)}
            />
            <SettingsDialog />
          </div>
        </MobileSidebarProvider>
      </UnreadProvider>
    </SocketProvider>
  )
}
