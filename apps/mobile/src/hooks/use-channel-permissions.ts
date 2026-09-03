import { workspaceAuthorityHasPermissions } from "@repo/auth/permissions"
import { useMemo } from "react"
import { useActiveMember } from "@/hooks/use-active-member"

type ChannelPermissions = {
  canCreateChannel: boolean
  canDeleteChannel: boolean
  canPinMessages: boolean
  canUpdateChannel: boolean
  isLoading: boolean
}

const EMPTY_PERMISSIONS: ChannelPermissions = {
  canCreateChannel: false,
  canDeleteChannel: false,
  canPinMessages: false,
  canUpdateChannel: false,
  isLoading: false,
}

export function useChannelPermissions(workspaceId?: string) {
  const member = useActiveMember(workspaceId)

  return useMemo<ChannelPermissions>(() => {
    if (!workspaceId) return EMPTY_PERMISSIONS
    if (member.isPending) return { ...EMPTY_PERMISSIONS, isLoading: true }

    const role = member.data?.role
    if (typeof role !== "string") {
      return EMPTY_PERMISSIONS
    }

    // Custom roles degrade to member-tier affordances here — mobile doesn't
    // fetch custom-role grants yet; the server enforces real grants.
    const authority = { role }
    return {
      canCreateChannel: workspaceAuthorityHasPermissions(authority, {
        channel: ["create"],
      }),
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
    }
  }, [workspaceId, member.isPending, member.data])
}
