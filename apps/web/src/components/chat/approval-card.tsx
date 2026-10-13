import {
  Cancel01Icon,
  LockKeyIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
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
  status: "pending" | "approved" | "rejected" | "expired"
  resolvedBy: string | null
}

// The gate card under a parked run's own message. Renders nothing unless
// this message's run parked on an approval. In a session it stays after the
// decision as its record: nothing else posts (the decision reaches Lor as
// the AI SDK approval response).
export function MessageApprovalCard({
  channelId,
  messageId,
  threadRootId,
}: {
  channelId: string
  messageId: string
  threadRootId: string | null
}) {
  const approval = useMessageApproval(channelId, messageId, threadRootId)
  if (!approval) return null
  return (
    <div className="mt-2 max-w-xl">
      <ApprovalGateCard
        channelId={channelId}
        threadRootId={threadRootId}
        approval={approval}
      />
    </div>
  )
}

// One approval gate, wherever it surfaces (plan header, channel/thread
// placeholder). Buttons show only for people the resolver spec allows — the
// server re-checks on resolve regardless.
export function ApprovalGateCard({
  channelId,
  threadRootId = null,
  approval,
}: {
  channelId: string
  // Lets a decision move the session's sidebar row at once.
  threadRootId?: string | null
  approval: ApprovalCardData
}) {
  const { workspaceSlug } = useParams({ strict: false })
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
    if (!activeMember) return
    resolve.mutate({
      approvalId: approval.id,
      resolution,
      userId: activeMember.userId,
      planId: approval.planId,
      threadRootId,
    })
  }

  const resolvedByName =
    approval.resolvedBy === activeMember?.userId
      ? "you"
      : (membersData?.members.find((m) => m.userId === approval.resolvedBy)
          ?.name ?? null)

  return (
    <ApprovalGateView
      approval={approval}
      canResolve={canResolve}
      pending={resolve.isPending}
      onResolve={onResolve}
      resolvedByName={resolvedByName}
    />
  )
}

const RESOLVED_LABEL = {
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
} as const

// One quiet row: what Lor wants to do, who can allow it, and the buttons;
// once decided, what was decided and by whom. Data in, callback out (the
// /design page renders it with sample data).
export function ApprovalGateView({
  approval,
  canResolve,
  pending,
  onResolve,
  resolvedByName,
}: {
  approval: ApprovalCardData
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject") => void
  resolvedByName: string | null
}) {
  if (approval.status !== "pending") {
    const approved = approval.status === "approved"
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/60 py-2 ps-3 pe-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            approved
              ? "bg-success/12 text-success-foreground"
              : "bg-foreground/[0.05] text-muted-foreground"
          )}
        >
          <HugeiconsIcon
            icon={approved ? Tick02Icon : Cancel01Icon}
            className="size-3.5"
            strokeWidth={2.25}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground/80 leading-5">
            {approval.description}
          </p>
          <p className="truncate text-muted-foreground text-xs leading-4">
            {RESOLVED_LABEL[approval.status]}
            {resolvedByName && ` by ${resolvedByName}`}
          </p>
        </div>
      </div>
    )
  }
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
