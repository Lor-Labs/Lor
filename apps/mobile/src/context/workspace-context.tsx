import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { authClient } from "@/lib/auth-client"

export type Workspace = {
  id: string
  name: string
  slug: string
  logo: string | null
  ownerId: string | null
  // First-run setup checklist (web only) is still open.
  setupPending: boolean
}

type WorkspaceContextValue = {
  workspace: Workspace | null
  workspaces: Workspace[]
  // Own membership color in the active workspace (colors are workspace-scoped)
  avatarColor: string | null
  isLoading: boolean
  error: string | null
  selectWorkspace: (workspaceId: string) => Promise<boolean>
  reloadWorkspaces: (activateWorkspaceId?: string) => Promise<void>
}

function toWorkspace(item: {
  id: string
  name: string
  slug: string
  logo?: string | null
  ownerId?: string | null
  setupCompletedAt?: Date | string | null
}): Workspace {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    logo: item.logo ?? null,
    ownerId: item.ownerId ?? null,
    setupPending: !item.setupCompletedAt,
  }
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [avatarColor, setAvatarColor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = workspace?.id

  useEffect(() => {
    let isCurrent = true
    if (!workspaceId) {
      setAvatarColor(null)
      return
    }
    void authClient.organization
      .getActiveMember()
      .then((result) => {
        if (isCurrent) setAvatarColor(result.data?.avatarColor ?? null)
      })
      .catch(() => {
        if (isCurrent) setAvatarColor(null)
      })
    return () => {
      isCurrent = false
    }
  }, [workspaceId])

  const selectWorkspace = async (workspaceId: string) => {
    const next = workspaces.find((item) => item.id === workspaceId)
    if (!next) return false

    setError(null)
    const result = await authClient.organization.setActive({
      organizationId: workspaceId,
    })
    if (result.error) {
      setError(result.error.message ?? "Could not open that workspace")
      return false
    }
    setWorkspace(next)
    return true
  }

  const reloadWorkspaces = async (activateWorkspaceId?: string) => {
    const result = await authClient.organization.list()
    if (result.error) {
      setError(result.error.message ?? "Could not load your workspaces")
      return
    }
    const nextWorkspaces = (result.data ?? []).map(toWorkspace)
    setError(null)
    setWorkspaces(nextWorkspaces)

    if (!activateWorkspaceId) return
    const next = nextWorkspaces.find((item) => item.id === activateWorkspaceId)
    if (!next) return

    const activeResult = await authClient.organization.setActive({
      organizationId: activateWorkspaceId,
    })
    if (activeResult.error) {
      setError(activeResult.error.message ?? "Could not open that workspace")
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
        const nextWorkspaces = (organizationsResult.data ?? []).map(toWorkspace)
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
    () => ({
      workspace,
      workspaces,
      avatarColor,
      isLoading,
      error,
      selectWorkspace,
      reloadWorkspaces,
    }),
    [workspace, workspaces, avatarColor, isLoading, error]
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
