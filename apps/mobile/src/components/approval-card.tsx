import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import LockKeyIcon from "@hugeicons/core-free-icons/LockKeyIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/context/workspace-context"
import {
  type ApprovalResolverSpec,
  resolverLabel,
  useCanResolveApproval,
  useMessageApprovals,
  useResolveChannelApproval,
} from "@/hooks/use-approvals"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { authClient } from "@/lib/auth-client"

export type ApprovalCardData = {
  id: string
  description: string
  toolName: string | null
  resolver: ApprovalResolverSpec | null
  resolverUserName: string | null
  status: "pending" | "approved" | "rejected" | "expired"
  resolvedBy: string | null
}

const RESOLVED_LABEL = {
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
} as const

// One approval gate under a Lor message: what Lor wants to do, who can allow
// it, and the buttons; once decided, what was
// decided and by whom. Buttons show only for people the resolver spec
// allows — the server re-checks on resolve regardless. Mirrors web's
// ApprovalGateView.
export function ApprovalGateCard({
  channelId,
  approval,
  onResolved,
}: {
  channelId: string
  approval: ApprovalCardData
  onResolved?: () => void
}) {
  const resolve = useResolveChannelApproval(channelId)
  const canResolve = useCanResolveApproval(approval.resolver)
  const { workspace } = useWorkspace()
  const { members } = useWorkspaceMembers(workspace?.slug ?? "")
  const { data: auth } = authClient.useSession()
  const [success, warning, muted] = useThemeColor([
    "success",
    "warning",
    "muted",
  ])

  if (approval.status !== "pending") {
    const approved = approval.status === "approved"
    const resolvedByName =
      approval.resolvedBy === auth?.user.id
        ? "you"
        : (members.find((member) => member.userId === approval.resolvedBy)
            ?.name ?? null)
    return (
      <View className="flex-row items-center gap-three rounded-lor-md border border-border px-three py-two">
        <View
          className={`size-7 items-center justify-center rounded-lor-sm ${
            approved ? "bg-success-soft" : "bg-surface-secondary"
          }`}
        >
          <HugeiconsIcon
            color={approved ? success : muted}
            icon={approved ? Tick02Icon : Cancel01Icon}
            size={14}
            strokeWidth={2.25}
          />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            className="text-[13px] leading-5 text-foreground"
            numberOfLines={2}
          >
            {approval.description}
          </Text>
          <Text className="text-xs text-muted" numberOfLines={1}>
            {RESOLVED_LABEL[approval.status]}
            {resolvedByName ? ` by ${resolvedByName}` : ""}
          </Text>
        </View>
      </View>
    )
  }

  const onPress = (resolution: "approve" | "reject") => {
    resolve.mutate(
      { approvalId: approval.id, resolution },
      {
        onSettled: () => {
          onResolved?.()
        },
      }
    )
  }

  return (
    <View className="gap-three rounded-lor-md border border-border bg-surface px-three py-three">
      <View className="flex-row items-start gap-three">
        <View className="size-7 items-center justify-center rounded-lor-sm bg-warning-soft">
          <HugeiconsIcon
            color={warning}
            icon={LockKeyIcon}
            size={14}
            strokeWidth={2}
          />
        </View>
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-[13px] font-medium leading-5 text-foreground">
            {approval.description}
          </Text>
          <Text className="text-xs text-muted">
            {canResolve
              ? "Needs your approval"
              : resolverLabel(approval.resolver, approval.resolverUserName)}
            {approval.toolName ? (
              <>
                {" · "}
                <Text className="font-mono">{approval.toolName}</Text>
              </>
            ) : null}
          </Text>
        </View>
      </View>
      {canResolve ? (
        <View className="flex-row justify-end gap-two">
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onPress("reject")}
            size="sm"
            variant="ghost"
          >
            Reject
          </Button>
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onPress("approve")}
            size="sm"
          >
            Approve
          </Button>
        </View>
      ) : null}
    </View>
  )
}

// The gate cards under a paused run's own message, one per gated call.
// Renders nothing unless this message's run paused on approvals. In a
// session they stay after the decision as its record (`threadRootId` lists
// resolved ones too); in chat they show only while pending.
export function MessageApprovalCard({
  channelId,
  messageId,
  threadRootId,
}: {
  channelId: string
  messageId: string
  threadRootId: string | null
}) {
  const approvals = useMessageApprovals(channelId, messageId, threadRootId)
  if (approvals.length === 0) return null
  return (
    <View className="gap-two pt-two">
      {approvals.map((approval) => (
        <ApprovalGateCard
          approval={approval}
          channelId={channelId}
          key={approval.id}
        />
      ))}
    </View>
  )
}
