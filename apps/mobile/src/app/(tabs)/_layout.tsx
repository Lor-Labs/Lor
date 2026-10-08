import { Redirect } from "expo-router"

import AppTabs from "@/components/app-tabs"
import { useWorkspace } from "@/context/workspace-context"
import { authClient } from "@/lib/auth-client"

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { workspaces, isLoading: isWorkspaceLoading } = useWorkspace()

  if (isPending) return null
  if (!session) return <Redirect href="/sign-in" />

  // Mirrors web: anyone without a workspace goes to onboarding.
  const needsOnboarding = !isWorkspaceLoading && workspaces.length === 0
  if (needsOnboarding) return <Redirect href="/onboarding" />

  return <AppTabs />
}
