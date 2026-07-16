import {
  isWorkspaceRole,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import { useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"

export function useCanPinMessages(workspaceId?: string) {
  const [canPinMessages, setCanPinMessages] = useState(false)

  useEffect(() => {
    let isCurrent = true
    setCanPinMessages(false)

    if (!workspaceId) {
      return () => {
        isCurrent = false
      }
    }

    void authClient.organization
      .getActiveMember()
      .then((result) => {
        if (!isCurrent) return
        const role = result.data?.role
        setCanPinMessages(
          typeof role === "string" &&
            isWorkspaceRole(role) &&
            workspaceAuthorityHasPermissions({ role }, { message: ["pin"] })
        )
      })
      .catch(() => {
        if (isCurrent) setCanPinMessages(false)
      })

    return () => {
      isCurrent = false
    }
  }, [workspaceId])

  return canPinMessages
}
