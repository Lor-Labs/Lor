import { Redirect } from "expo-router"

import AppTabs from "@/components/app-tabs"
import { authClient } from "@/lib/auth-client"

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null
  if (!session) return <Redirect href="/sign-in" />

  return <AppTabs />
}
