import {
  type PermissionRequest,
  workspaceAuthorityHasPermissions,
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
import type { ChannelProposal } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export const channelProposalsQueryKey = (channelId: string) =>
  ["channel-proposals", channelId] as const

function channelProposalsQueryOptions(channelId: string) {
  return {
    queryKey: channelProposalsQueryKey(channelId),
    // Card rows mount useMessageProposal against the same key; a short
    // staleTime keeps each new observer from refetching the whole channel
    // (proposal:updated invalidations keep it live regardless).
    staleTime: 30_000,
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelProposal[]> => {
      const res = await api.v1.channels[":channelId"].proposals.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel proposals")
      const payload = await res.json()
      return payload.proposals
    },
  }
}

// The channel's change proposals (all statuses — resolved cards render their
// terminal state), kept live by proposal:updated (channel room). Mount once
// per channel screen; the per-message hook reads the same cache.
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

// The proposal anchored to one proposal_card message.
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
  requiredPermissions: Record<string, string[]>
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
  return workspaceAuthorityHasPermissions(
    authority,
    requiredPermissions as PermissionRequest
  )
}

// Approver-typed secret values, keyed by op position then secret name. They
// ride the approve request only.
export type ProposalSecretsPayload = Record<string, Record<string, string>>

// The card shows a decision at once; a failure puts it back. Mirrors web.
function useOptimisticProposal(channelId: string) {
  const queryClient = useQueryClient()
  const queryKey = channelProposalsQueryKey(channelId)
  return {
    patch: async (proposalId: string, change: Partial<ChannelProposal>) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ChannelProposal[]>(queryKey)
      queryClient.setQueryData<ChannelProposal[]>(queryKey, (proposals) =>
        proposals?.map((p) => (p.id === proposalId ? { ...p, ...change } : p))
      )
      return { previous }
    },
    restore: (context: { previous?: ChannelProposal[] } | undefined) =>
      queryClient.setQueryData(queryKey, context?.previous),
  }
}

export function useApproveProposal(channelId: string) {
  const queryClient = useQueryClient()
  const optimistic = useOptimisticProposal(channelId)
  return useMutation({
    mutationFn: async (args: {
      proposalId: string
      secrets?: ProposalSecretsPayload
    }) => {
      const res = await api.v1.proposals[":proposalId"].approve.$post({
        param: { proposalId: args.proposalId },
        json: { secrets: args.secrets },
      })
      if (!res.ok) throw new Error("Failed to approve the proposal")
      return res.json()
    },
    // "approved" is the server's own applying state; the card reads it as
    // "Applying" until the apply lands as applied or failed.
    onMutate: ({ proposalId }) =>
      optimistic.patch(proposalId, { status: "approved" }),
    onSuccess: (payload) => {
      // 200 with status "failed": the apply transaction rolled back — the
      // card shows the failing operation's error.
      if (payload.proposal.status === "failed") {
        Alert.alert(
          "Couldn't apply the changes",
          "Nothing was created. See the card for what failed."
        )
      }
    },
    onError: (_error, _args, context) => {
      optimistic.restore(context)
      Alert.alert("Couldn't approve", "Please try again in a moment.")
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
  const optimistic = useOptimisticProposal(channelId)
  const { data: auth } = authClient.useSession()
  return useMutation({
    mutationFn: async (args: { proposalId: string; note?: string }) => {
      const res = await api.v1.proposals[":proposalId"].reject.$post({
        param: { proposalId: args.proposalId },
        json: { note: args.note },
      })
      if (!res.ok) throw new Error("Failed to reject the proposal")
      return res.json()
    },
    onMutate: ({ proposalId, note }) =>
      optimistic.patch(proposalId, {
        status: "rejected",
        resolvedByUserId: auth?.user.id ?? null,
        resolvedAt: new Date().toISOString(),
        resolutionNote: note ?? null,
      }),
    onError: (_error, _args, context) => {
      optimistic.restore(context)
      Alert.alert("Couldn't reject", "Please try again in a moment.")
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelProposalsQueryKey(channelId),
      })
    },
  })
}
