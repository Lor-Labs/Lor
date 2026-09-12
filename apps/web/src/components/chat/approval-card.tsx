import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import {
  type ApprovalResolverSpec,
  resolverLabel,
  useCanResolveApproval,
  useMessageApproval,
  useResolveChannelApproval,
} from "@/hooks/use-approvals"
import { apiClient } from "@/lib/api-client"

export type ApprovalCardData = {
  id: string
  description: string
  planId: string | null
  target: string | null
  toolName: string | null
  resolver: ApprovalResolverSpec | null
  resolverUserName: string | null
}

// The gate card under a parked run's own message (channel or thread scope).
// Mounted only on Merlin run replies; renders nothing unless this message's
// run parked on a pending approval.
export function MessageApprovalCard({
  channelId,
  messageId,
}: {
  channelId: string
  messageId: string
}) {
  const approval = useMessageApproval(channelId, messageId)
  if (!approval) return null
  return (
    <div className="mt-2 max-w-lg">
      <ApprovalGateCard channelId={channelId} approval={approval} />
    </div>
  )
}

// One approval gate, wherever it surfaces (plan header, channel/thread
// placeholder). Buttons show only for people the resolver spec allows — the
// server re-checks on resolve regardless.
export function ApprovalGateCard({
  channelId,
  approval,
}: {
  channelId: string
  approval: ApprovalCardData
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const resolve = useResolveChannelApproval(channelId)

  // Same queries the settings dialog runs, deduped by react-query.
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? {
            userId: res.data.userId as string,
            role: res.data.role as string,
          }
        : null
    },
    enabled: !!workspaceSlug,
  })
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug,
  })

  const canResolve = useCanResolveApproval(
    membersData?.workspaceId,
    activeMember ?? null,
    membersData?.ownerId,
    approval.resolver
  )

  const onResolve = (resolution: "approve" | "reject") => {
    resolve.mutate(
      { approvalId: approval.id, resolution },
      {
        onSettled: () => {
          if (approval.planId) {
            void queryClient.invalidateQueries({
              queryKey: ["plan", approval.planId],
            })
          }
        },
      }
    )
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="font-medium text-sm">Merlin asks for approval</p>
      <p className="mt-1 text-muted-foreground text-sm">
        {approval.description}
      </p>
      {approval.toolName && (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
          {approval.toolName}
        </p>
      )}
      {canResolve ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={resolve.isPending}
            onClick={() => onResolve("approve")}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => onResolve("reject")}
          >
            Reject
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground text-xs">
          {resolverLabel(approval.resolver, approval.resolverUserName)}
        </p>
      )}
    </div>
  )
}
