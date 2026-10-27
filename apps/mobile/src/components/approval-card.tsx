import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import {
  ApprovalHeader,
  answerSummary,
  PlanApprovalCard,
  QuestionApprovalCard,
  type ResolveExtra,
} from "@/components/claude-code-approval"
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
import type { ChannelApproval } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export type ApprovalCardData = {
  id: string
  description: string
  toolName: string | null
  resolver: ApprovalResolverSpec | null
  resolverUserName: string | null
  // A Claude Code prompt: only the turn's sender decides it.
  onlyUserId?: string | null
  // A Claude Code plan waiting for approval: its Markdown.
  plan?: string | null
  // A Claude Code question: its questions, and once answered, the answers.
  questions?: ChannelApproval["questions"]
  answers?: ChannelApproval["answers"]
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
  const canResolve = useCanResolveApproval(
    approval.resolver,
    approval.onlyUserId
  )
  const { workspace } = useWorkspace()
  const { members } = useWorkspaceMembers(workspace?.slug ?? "")
  const { data: auth } = authClient.useSession()
  const [success, muted] = useThemeColor(["success", "muted"])

  const onResolve = (
    resolution: "approve" | "reject",
    extra: ResolveExtra = {}
  ) => {
    resolve.mutate(
      {
        approvalId: approval.id,
        resolution,
        ...(extra.planMode ? { claudeCodeMode: extra.planMode } : {}),
        ...(extra.answers ? { answers: extra.answers } : {}),
      },
      { onSettled: () => onResolved?.() }
    )
  }
  const statusLine = canResolve
    ? "Needs your approval"
    : resolverLabel(approval.resolver, approval.resolverUserName)

  if (approval.status === "pending" && approval.plan) {
    return (
      <PlanApprovalCard
        canResolve={canResolve}
        description={approval.description}
        onResolve={onResolve}
        pending={resolve.isPending}
        plan={approval.plan}
        statusLine={statusLine}
      />
    )
  }
  if (approval.status === "pending" && approval.questions) {
    return (
      <QuestionApprovalCard
        canResolve={canResolve}
        description={approval.description}
        onResolve={onResolve}
        pending={resolve.isPending}
        questions={approval.questions}
        statusLine={statusLine}
      />
    )
  }

  if (approval.status !== "pending") {
    const approved = approval.status === "approved"
    const resolvedByName =
      approval.resolvedBy === auth?.user.id
        ? "you"
        : (members.find((member) => member.userId === approval.resolvedBy)
            ?.name ?? null)
    const answered =
      approval.questions && approval.answers
        ? answerSummary(approval.questions, approval.answers)
        : null
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
          <Text className="text-xs text-muted" numberOfLines={2}>
            {approval.questions
              ? approved
                ? "Answered"
                : "Skipped"
              : RESOLVED_LABEL[approval.status]}
            {resolvedByName ? ` by ${resolvedByName}` : ""}
            {answered ? ` · ${answered}` : ""}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View className="gap-three rounded-lor-md border border-border bg-surface px-three py-three">
      <ApprovalHeader
        description={approval.description}
        statusLine={
          <>
            {statusLine}
            {approval.toolName ? (
              <>
                {" · "}
                <Text className="font-mono">{approval.toolName}</Text>
              </>
            ) : null}
          </>
        }
      />
      {canResolve ? (
        <View className="flex-row justify-end gap-two">
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onResolve("reject")}
            size="sm"
            variant="ghost"
          >
            Reject
          </Button>
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onResolve("approve")}
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
