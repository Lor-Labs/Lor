import {
  type PermissionRequest,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { toCustomRoleMap, useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type { ChannelProposal } from "@/lib/api-types"

export type { ChannelProposal }

export const channelProposalsQueryKey = (channelId: string) =>
  ["channel-proposals", channelId] as const

function channelProposalsQueryOptions(channelId: string) {
  return {
    queryKey: channelProposalsQueryKey(channelId),
    queryFn: async (): Promise<ChannelProposal[]> => {
      const res = await apiClient.v1.channels[":channelId"].proposals.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel proposals")
      const payload = await res.json()
      return payload.proposals
    },
  }
}

// The channel's change proposals (all statuses — resolved cards render their
// terminal state), kept live by proposal:updated (channel room). Mounted once
// by the session page; the per-message hook reads the same cache.
export function useChannelProposals(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelProposalsQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const handleUpdated: ServerToClientEvents["proposal:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({
        queryKey: channelProposalsQueryKey(channelId),
      })
    }
    socket.on("proposal:updated", handleUpdated)
    return () => {
      socket.off("proposal:updated", handleUpdated)
    }
  }, [socket, queryClient, channelId])

  return query
}

// The proposal anchored to one proposal_card message. Shares the channel
// query's cache; select keeps other cards from re-rendering this one.
export function useMessageProposal(
  channelId: string,
  cardMessageId: string
): ChannelProposal | null {
  const { data } = useQuery({
    ...channelProposalsQueryOptions(channelId),
    select: (proposals: ChannelProposal[]) =>
      proposals.find((p) => p.cardMessageId === cardMessageId) ?? null,
  })
  return data ?? null
}

// Client-side mirror of the server's authority-union gate, for showing/hiding
// the buttons only — approve/reject re-check with real authority.
export function useCanResolveProposal(
  workspaceId: string | undefined,
  member: { userId: string; role: string } | null,
  ownerId: string | undefined,
  requiredPermissions: Record<string, string[]>
): boolean {
  const { data: customRoles } = useWorkspaceRoles(workspaceId)
  if (!member || !ownerId) return false
  const authority = {
    role: member.role,
    isOwner: ownerId === member.userId,
    customGrants: toCustomRoleMap(customRoles)[member.role] ?? null,
  }
  return workspaceAuthorityHasPermissions(
    authority,
    requiredPermissions as PermissionRequest
  )
}

// Approver-typed secret values, keyed by op position then secret name. They
// ride this request only.
export type ProposalSecretsPayload = Record<string, Record<string, string>>

export function useApproveProposal(channelId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      proposalId: string
      secrets?: ProposalSecretsPayload
    }) => {
      const res = await apiClient.v1.proposals[":proposalId"].approve.$post({
        param: { proposalId: args.proposalId },
        json: { secrets: args.secrets },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to approve the proposal")
      }
      return res.json()
    },
    onSuccess: (payload) => {
      // 200 with status "failed" means the apply transaction rolled back —
      // the card shows the failing operation's error.
      if (payload.proposal.status === "failed") {
        toast.error("The changes could not be applied — see the card")
      }
    },
    onError: (err) => {
      toast.error(err.message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelProposalsQueryKey(channelId),
      })
    },
  })
}

export function useRejectProposal(channelId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { proposalId: string; note?: string }) => {
      const res = await apiClient.v1.proposals[":proposalId"].reject.$post({
        param: { proposalId: args.proposalId },
        json: { note: args.note },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to reject the proposal")
      }
      return res.json()
    },
    onError: (err) => {
      toast.error(err.message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelProposalsQueryKey(channelId),
      })
    },
  })
}
