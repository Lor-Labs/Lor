import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { authClient } from "@/lib/auth-client"

type Workspace = {
  id: string
  name: string
  slug: string
  logo: string | null
}

type WorkspaceContextValue = {
  workspace: Workspace | null
  workspaces: Workspace[]
  isLoading: boolean
  error: string | null
  selectWorkspace: (workspaceId: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectWorkspace = async (workspaceId: string) => {
    const next = workspaces.find((item) => item.id === workspaceId)
    if (!next) return

    setError(null)
    const result = await authClient.organization.setActive({
      organizationId: workspaceId,
    })
    if (result.error) {
      setError(result.error.message ?? "Could not open that workspace")
      return
    }
    setWorkspace(next)
  }

  useEffect(() => {
    let isCurrent = true

    if (isSessionPending)
      return () => {
        isCurrent = false
      }
    if (!session) {
      setWorkspaces([])
      setWorkspace(null)
      setError(null)
      setIsLoading(false)
      return () => {
        isCurrent = false
      }
    }

    setIsLoading(true)
    void (async () => {
      try {
        const [organizationsResult, activeResult] = await Promise.all([
          authClient.organization.list(),
          authClient.organization.getFullOrganization(),
        ])
        const nextWorkspaces = (organizationsResult.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          slug: item.slug,
          logo: item.logo ?? null,
        }))
        if (!isCurrent) return

        setWorkspaces(nextWorkspaces)
        const active = nextWorkspaces.find(
          (item) => item.id === activeResult.data?.id
        )
        const initial = active ?? nextWorkspaces[0] ?? null

        if (initial && !active) {
          const result = await authClient.organization.setActive({
            organizationId: initial.id,
          })
          if (result.error && isCurrent) {
            setError(result.error.message ?? "Could not open your workspace")
            return
          }
        }
        if (isCurrent) setWorkspace(initial)
      } catch {
        if (isCurrent) setError("Could not load your workspaces")
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    })()

    return () => {
      isCurrent = false
    }
  }, [isSessionPending, session])

  const value = useMemo(
    () => ({ workspace, workspaces, isLoading, error, selectWorkspace }),
    [workspace, workspaces, isLoading, error]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error("useWorkspace must be inside WorkspaceProvider")
  return context
}
