import {
  approvalResolverLabel,
  canResolveApproval,
  normalizeApprovalResolverSpec,
} from "@repo/auth/permissions"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useActiveMember } from "@/hooks/use-active-member"
import { useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { api } from "@/lib/api"
import type { ChannelApproval } from "@/lib/api-types"

export type ApprovalResolverSpec = ChannelApproval["resolver"]

export const channelApprovalsQueryKey = (channelId: string) =>
  ["channel-approvals", channelId] as const

function channelApprovalsQueryOptions(channelId: string) {
  return {
    queryKey: channelApprovalsQueryKey(channelId),
    // Message rows mount useMessageApproval against the same key; a short
    // staleTime keeps each new observer from refetching the whole channel
    // (approval:created/updated invalidations keep it live regardless).
    staleTime: 30_000,
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelApproval[]> => {
      const res = await api.v1.channels[":channelId"].approvals.$get({
        param: { channelId },
        query: {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel approvals")
      const payload = await res.json()
      return payload.approvals
    },
  }
}

// Pending policy-gated approvals for the channel, kept live by
// approval:created/updated (channel room). Mount once per channel screen; the
// per-message hook below reads the same cache without its own socket work.
export function useChannelApprovals(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelApprovalsQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const refetch = (payload: { channelId: string }) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({
        queryKey: channelApprovalsQueryKey(channelId),
      })
    }
    const handleCreated: ServerToClientEvents["approval:created"] = refetch
    const handleUpdated: ServerToClientEvents["approval:updated"] = refetch
    socket.on("approval:created", handleCreated)
    socket.on("approval:updated", handleUpdated)
    return () => {
      socket.off("approval:created", handleCreated)
      socket.off("approval:updated", handleUpdated)
    }
  }, [socket, queryClient, channelId])

  return query
}

// The pending approval anchored to one Lor message, if any.
export function useMessageApproval(
  channelId: string,
  messageId: string
): ChannelApproval | null {
  const { data } = useQuery({
    ...channelApprovalsQueryOptions(channelId),
    select: (approvals: ChannelApproval[]) =>
      approvals.find(
        (a) => a.messageId === messageId && a.status === "pending"
      ) ?? null,
  })
  return data ?? null
}

// Client-side mirror of the server's resolver check, for showing/hiding the
// buttons only — the resolve endpoint re-checks with real authority.
export function useCanResolveApproval(
  resolver: ApprovalResolverSpec | null
): boolean {
  const { workspace } = useWorkspace()
  const member = useActiveMember(workspace?.id)
  const { data: customRoles } = useWorkspaceRoles(workspace?.id)

  const role = member.data?.role
  const userId = member.data?.userId
  if (!workspace?.ownerId || typeof role !== "string" || !userId) return false
  const authority = {
    role,
    isOwner: workspace.ownerId === userId,
    customGrants: customRoles?.find((r) => r.role === role)?.grants ?? null,
  }
  // Dangling or malformed named resolver: owner-only, matching the server.
  const spec = normalizeApprovalResolverSpec(resolver ?? null)
  if (!spec) return authority.isOwner
  return canResolveApproval(authority, spec, userId)
}

// Plain-words note for people who can't resolve: who can.
export { approvalResolverLabel as resolverLabel }

export function useResolveChannelApproval(channelId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      approvalId: string
      resolution: "approve" | "reject"
    }) => {
      const endpoint =
        api.v1.approvals[":approvalId"][
          args.resolution === "approve" ? "approve" : "reject"
        ]
      const res = await endpoint.$post({
        param: { approvalId: args.approvalId },
      })
      if (!res.ok) throw new Error("Failed to resolve approval")
      return res.json()
    },
    onError: (_error, args) => {
      Alert.alert(
        args.resolution === "approve" ? "Couldn't approve" : "Couldn't reject",
        "Please try again in a moment."
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelApprovalsQueryKey(channelId),
      })
    },
  })
}
