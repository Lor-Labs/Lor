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
import { authClient } from "@/lib/auth-client"

export type ApprovalResolverSpec = ChannelApproval["resolver"]

export const channelApprovalsQueryKey = (channelId: string) =>
  ["channel-approvals", channelId] as const

// With a session's thread: every approval in it, so resolved cards show who
// decided. Without: the channel's pending ones (old chat cards). Same keys as
// web.
function channelApprovalsQueryOptions(
  channelId: string,
  threadRootId: string | null
) {
  return {
    queryKey: [...channelApprovalsQueryKey(channelId), threadRootId] as const,
    // Message rows mount useMessageApprovals against the same key; a short
    // staleTime keeps each new observer from refetching the whole channel
    // (approval:created/updated invalidations keep it live regardless).
    staleTime: 30_000,
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelApproval[]> => {
      const res = await api.v1.channels[":channelId"].approvals.$get({
        param: { channelId },
        query: threadRootId ? { threadRootId } : {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel approvals")
      const payload = await res.json()
      return payload.approvals
    },
  }
}

// Approvals kept live by approval:created/updated (channel room). Mount once
// per screen; the per-message hook below reads the same cache without its
// own socket work.
export function useChannelApprovals(
  channelId: string,
  threadRootId: string | null = null
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelApprovalsQueryOptions(channelId, threadRootId))

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

// The approvals anchored to one Lor message (a paused turn files one per
// gated call): in a session, pending or resolved; in chat, pending only.
export function useMessageApprovals(
  channelId: string,
  messageId: string,
  threadRootId: string | null
): ChannelApproval[] {
  const { data } = useQuery({
    ...channelApprovalsQueryOptions(channelId, threadRootId),
    select: (approvals: ChannelApproval[]) =>
      approvals.filter((a) => a.messageId === messageId),
  })
  return data ?? []
}

// The Lor message whose turn is paused on pending approvals, if any: Stop
// rejects them all.
export function usePausedLorMessageId(
  channelId: string,
  threadRootId: string | null
): string | null {
  const { data } = useQuery({
    ...channelApprovalsQueryOptions(channelId, threadRootId),
    select: (approvals: ChannelApproval[]) =>
      approvals.find((a) => a.status === "pending")?.messageId ?? null,
  })
  return data ?? null
}

// Client-side mirror of the server's resolver check, for showing/hiding the
// buttons only — the resolve endpoint re-checks with real authority.
export function useCanResolveApproval(
  resolver: ApprovalResolverSpec | null,
  // A Claude Code prompt: only the turn's sender, the owner included.
  onlyUserId?: string | null
): boolean {
  const { workspace } = useWorkspace()
  const member = useActiveMember(workspace?.id)
  const { data: customRoles } = useWorkspaceRoles(workspace?.id)

  const role = member.data?.role
  const userId = member.data?.userId
  if (!workspace?.ownerId || typeof role !== "string" || !userId) return false
  if (onlyUserId) return userId === onlyUserId
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
  const { data: auth } = authClient.useSession()
  const queryKey = channelApprovalsQueryKey(channelId)
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
    // The card shows the decision at once; a failure puts it back.
    onMutate: async ({ approvalId, resolution }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueriesData<ChannelApproval[]>({
        queryKey,
      })
      const status = resolution === "approve" ? "approved" : "rejected"
      queryClient.setQueriesData<ChannelApproval[]>({ queryKey }, (current) =>
        current?.map((approval) =>
          approval.id === approvalId
            ? {
                ...approval,
                status,
                resolvedBy: auth?.user.id ?? null,
                resolvedAt: new Date().toISOString(),
              }
            : approval
        )
      )
      return { previous }
    },
    onError: (_error, args, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data)
      }
      Alert.alert(
        args.resolution === "approve" ? "Couldn't approve" : "Couldn't reject",
        "Please try again in a moment."
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
