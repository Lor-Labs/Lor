import {
  approvalResolverLabel,
  canResolveApproval,
  normalizeApprovalResolverSpec,
} from "@repo/auth/permissions"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { toCustomRoleMap, useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type { ChannelApproval } from "@/lib/api-types"

export type ApprovalResolverSpec = NonNullable<ChannelApproval["resolver"]>
export type { ChannelApproval }

export const channelApprovalsQueryKey = (channelId: string) =>
  ["channel-approvals", channelId] as const

function channelApprovalsQueryOptions(channelId: string) {
  return {
    queryKey: channelApprovalsQueryKey(channelId),
    queryFn: async (): Promise<ChannelApproval[]> => {
      const res = await apiClient.v1.channels[":channelId"].approvals.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel approvals")
      const payload = await res.json()
      return payload.approvals
    },
  }
}

// Pending policy-gated approvals for the channel, kept live by
// approval:created/updated (channel room). Mount once per channel view — the
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

// The pending approval anchored to one Merlin message, if any. Shares the
// channel query's cache; select keeps a message from re-rendering on other
// messages' approvals.
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
  workspaceId: string | undefined,
  member: { userId: string; role: string } | null,
  ownerId: string | undefined,
  resolver: ApprovalResolverSpec | null
): boolean {
  const { data: customRoles } = useWorkspaceRoles(workspaceId)
  if (!member || !ownerId) return false
  const authority = {
    role: member.role,
    isOwner: ownerId === member.userId,
    customGrants: toCustomRoleMap(customRoles)[member.role] ?? null,
  }
  const spec = normalizeApprovalResolverSpec(resolver)
  if (!spec) return authority.isOwner
  return canResolveApproval(authority, spec, member.userId)
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
        apiClient.v1.approvals[":approvalId"][
          args.resolution === "approve" ? "approve" : "reject"
        ]
      const res = await endpoint.$post({
        param: { approvalId: args.approvalId },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to resolve approval")
      }
      return res.json()
    },
    onError: (err) => {
      toast.error(err.message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelApprovalsQueryKey(channelId),
      })
    },
  })
}
