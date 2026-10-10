import { LockKeyIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
// Mounted only on Lor run replies; renders nothing unless this message's
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
    <div className="mt-2 max-w-xl">
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
    <ApprovalGateView
      approval={approval}
      canResolve={canResolve}
      pending={resolve.isPending}
      onResolve={onResolve}
    />
  )
}

// One quiet row: what Lor wants to do, who can allow it, and the buttons.
// Data in, callback out (the /design page renders it with sample data).
export function ApprovalGateView({
  approval,
  canResolve,
  pending,
  onResolve,
}: {
  approval: ApprovalCardData
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject") => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-card py-2.5 ps-3 pe-2.5 dark:bg-foreground/[0.025]">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning-foreground">
        <HugeiconsIcon
          icon={LockKeyIcon}
          className="size-3.5"
          strokeWidth={2}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-5">
          {approval.description}
        </p>
        <p className="truncate text-muted-foreground text-xs leading-4">
          {canResolve
            ? "Needs your approval"
            : resolverLabel(approval.resolver, approval.resolverUserName)}
          {approval.toolName && (
            <>
              {" · "}
              <span className="font-mono">{approval.toolName}</span>
            </>
          )}
        </p>
      </div>
      {canResolve && (
        <div className="ms-auto flex shrink-0 gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onResolve("reject")}
          >
            Reject
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onResolve("approve")}
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}
