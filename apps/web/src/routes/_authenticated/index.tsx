import { authClient } from "@repo/auth/client"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import {
  readLastChannelId,
  readLastSessionId,
  readLastWorkspaceSlug,
} from "@/lib/last-location"

export const Route = createFileRoute("/_authenticated/")({
  component: LandingRedirect,
})

// Send returning users back to the last workspace/channel they were in; fall
// back to DMs only when there's no valid last workspace. Users with no
// workspace at all go to onboarding.
function LandingRedirect() {
  const navigate = useNavigate()
  const { data: workspaces, isPending } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      return res.data
    },
  })

  useEffect(() => {
    if (isPending) return

    if (workspaces?.length === 0) {
      void navigate({ to: "/onboarding", replace: true })
      return
    }

    const slug = readLastWorkspaceSlug()
    const isValid = !!slug && !!workspaces?.some((w) => w.slug === slug)

    if (isValid && slug) {
      const sessionId = readLastSessionId(slug)
      const channelId = readLastChannelId(slug)
      if (sessionId) {
        void navigate({
          to: "/$workspaceSlug/session/$sessionId",
          params: { workspaceSlug: slug, sessionId },
          replace: true,
        })
      } else if (channelId) {
        void navigate({
          to: "/$workspaceSlug/$channelId",
          params: { workspaceSlug: slug, channelId },
          replace: true,
        })
      } else {
        void navigate({
          to: "/$workspaceSlug",
          params: { workspaceSlug: slug },
          replace: true,
        })
      }
      return
    }

    void navigate({ to: "/dms", replace: true })
  }, [isPending, workspaces, navigate])

  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  )
}
