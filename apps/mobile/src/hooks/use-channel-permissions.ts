import {
  isWorkspaceRole,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"

type ChannelPermissions = {
  canDeleteChannel: boolean
  canPinMessages: boolean
  canUpdateChannel: boolean
  isLoading: boolean
}

const EMPTY_PERMISSIONS: ChannelPermissions = {
  canDeleteChannel: false,
  canPinMessages: false,
  canUpdateChannel: false,
  isLoading: false,
}

export function useChannelPermissions(workspaceId?: string) {
  const [permissions, setPermissions] = useState<ChannelPermissions>({
    ...EMPTY_PERMISSIONS,
    isLoading: Boolean(workspaceId),
  })

  useEffect(() => {
    let isCurrent = true

    if (!workspaceId) {
      setPermissions(EMPTY_PERMISSIONS)
      return () => {
        isCurrent = false
      }
    }

    setPermissions({ ...EMPTY_PERMISSIONS, isLoading: true })
    void authClient.organization
      .getActiveMember()
      .then((result) => {
        if (!isCurrent) return
        const role = result.data?.role
        if (typeof role !== "string" || !isWorkspaceRole(role)) {
          setPermissions(EMPTY_PERMISSIONS)
          return
        }

        const authority = { role }
        setPermissions({
          canDeleteChannel: workspaceAuthorityHasPermissions(authority, {
            channel: ["delete"],
          }),
          canPinMessages: workspaceAuthorityHasPermissions(authority, {
            message: ["pin"],
          }),
          canUpdateChannel: workspaceAuthorityHasPermissions(authority, {
            channel: ["update"],
          }),
          isLoading: false,
        })
      })
      .catch(() => {
        if (isCurrent) setPermissions(EMPTY_PERMISSIONS)
      })

    return () => {
      isCurrent = false
    }
  }, [workspaceId])

  return permissions
}
