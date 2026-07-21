import { Redirect } from "expo-router"

import AppTabs from "@/components/app-tabs"
import { useWorkspace } from "@/context/workspace-context"
import { authClient } from "@/lib/auth-client"
import { hasValidUsername } from "@/lib/username"

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { workspaces, isLoading: isWorkspaceLoading } = useWorkspace()

  if (isPending) return null
  if (!session) return <Redirect href="/sign-in" />

  // Mirrors web's onboarding gate: the flag guards existing users, and the
  // composite handles invited users who joined without ever picking a username.
  const needsOnboarding =
    session.user.onboardingCompleted === false &&
    !isWorkspaceLoading &&
    (workspaces.length === 0 || !hasValidUsername(session.user.username))
  if (needsOnboarding) return <Redirect href="/onboarding" />

  return <AppTabs />
}
