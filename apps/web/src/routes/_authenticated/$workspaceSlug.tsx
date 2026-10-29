import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, Navigate, Outlet } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { HowLorWorksDialog } from "@/components/onboarding/how-lor-works-dialog"
import { BetaStatus } from "@/components/workspace/beta-status"

export const Route = createFileRoute("/_authenticated/$workspaceSlug")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  const { workspaceSlug } = Route.useParams()
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const latestDesiredWorkspaceRef = useRef<string | null>(null)
  const switchRequestRef = useRef(0)

  const { data: workspaces, isPending: workspacesLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      return res.data
    },
  })
  const { data: activeOrg } = useQuery({
    queryKey: ["active-workspace"],
    queryFn: async () => {
      const res = await authClient.organization.getFullOrganization()
      return res.data
    },
  })

  const workspace = useMemo(
    () => workspaces?.find((g) => g.slug === workspaceSlug),
    [workspaces, workspaceSlug]
  )

  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false

    if (!workspace) {
      latestDesiredWorkspaceRef.current = null
      setSwitchError(null)
      setIsSwitchingWorkspace(false)
      return
    }

    const desiredWorkspaceId = workspace.id
    latestDesiredWorkspaceRef.current = desiredWorkspaceId

    if (activeOrg?.id === desiredWorkspaceId) {
      setSwitchError(null)
      setIsSwitchingWorkspace(false)
      return
    }

    const requestId = ++switchRequestRef.current
    setSwitchError(null)
    setIsSwitchingWorkspace(true)

    void (async () => {
      try {
        await authClient.organization.setActive({
          organizationId: desiredWorkspaceId,
        })

        if (
          cancelled ||
          latestDesiredWorkspaceRef.current !== desiredWorkspaceId ||
          switchRequestRef.current !== requestId
        ) {
          return
        }

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["active-workspace"],
          }),
          queryClient.invalidateQueries({
            queryKey: ["active-workspace-member", workspaceSlug],
          }),
        ])
      } catch (error) {
        if (
          cancelled ||
          latestDesiredWorkspaceRef.current !== desiredWorkspaceId ||
          switchRequestRef.current !== requestId
        ) {
          return
        }

        console.error(
          "[workspace-layout] Failed to switch active workspace",
          error
        )
        const message = "Failed to switch workspace. Please try again."
        setSwitchError(message)
        toast.error(message)
      } finally {
        if (
          !cancelled &&
          latestDesiredWorkspaceRef.current === desiredWorkspaceId &&
          switchRequestRef.current === requestId
        ) {
          setIsSwitchingWorkspace(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspace, activeOrg?.id, workspaceSlug, queryClient])

  if (workspacesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  // A URL for a workspace this account isn't in: a stale bookmark, a removed
  // membership, or a link left over from another account in this tab.
  if (!workspace) {
    if (workspaces?.length === 0) return <Navigate to="/onboarding" replace />
    const fallback = workspaces?.[0]
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <span className="text-sm text-muted-foreground">
          Workspace not found
        </span>
        {fallback && (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/$workspaceSlug"
                params={{ workspaceSlug: fallback.slug }}
              />
            }
          >
            Go to {fallback.name}
          </Button>
        )}
      </div>
    )
  }

  if (isSwitchingWorkspace) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (activeOrg?.id !== workspace.id) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {switchError ?? "Loading..."}
        </span>
      </div>
    )
  }

  return (
    <>
      <BetaStatus workspaceSlug={workspaceSlug} />
      <Outlet />
      <HowLorWorksDialog workspaceName={workspace.name} />
    </>
  )
}
