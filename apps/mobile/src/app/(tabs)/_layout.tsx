import { Redirect } from "expo-router"

import AppTabs from "@/components/app-tabs"
import { useWorkspace } from "@/context/workspace-context"
import { authClient } from "@/lib/auth-client"

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { workspaces, isLoading: isWorkspaceLoading } = useWorkspace()

  if (isPending) return null
  if (!session) return <Redirect href="/sign-in" />

  // Mirrors web's onboarding gate: the flag guards existing users, and the
  // workspace check handles invited users who joined through an invite link.
  const needsOnboarding =
    session.user.onboardingCompleted === false &&
    !isWorkspaceLoading &&
    workspaces.length === 0
  if (needsOnboarding) return <Redirect href="/onboarding" />

  return <AppTabs />
}
