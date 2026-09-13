import { useQueryClient } from "@tanstack/react-query"
import { Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import {
  type ApprovalResolverSpec,
  resolverLabel,
  useCanResolveApproval,
  useMessageApproval,
  useResolveChannelApproval,
} from "@/hooks/use-approvals"

export type ApprovalCardData = {
  id: string
  description: string
  planId: string | null
  toolName: string | null
  resolver: ApprovalResolverSpec | null
  resolverUserName: string | null
}

// One approval gate, wherever it surfaces (plan header, channel/thread
// message). Buttons show only for people the resolver spec allows — the
// server re-checks on resolve regardless.
export function ApprovalGateCard({
  channelId,
  approval,
  onResolved,
}: {
  channelId: string
  approval: ApprovalCardData
  onResolved?: () => void
}) {
  const queryClient = useQueryClient()
  const resolve = useResolveChannelApproval(channelId)
  const canResolve = useCanResolveApproval(approval.resolver)

  const onPress = (resolution: "approve" | "reject") => {
    resolve.mutate(
      { approvalId: approval.id, resolution },
      {
        onSettled: () => {
          if (approval.planId) {
            void queryClient.invalidateQueries({
              queryKey: ["plan", approval.planId],
            })
          }
          onResolved?.()
        },
      }
    )
  }

  return (
    <View className="gap-two rounded-lor-sm bg-warning-soft p-three">
      <Text className="text-sm font-semibold text-foreground">
        Lor asks for approval
      </Text>
      <Text className="text-sm leading-5 text-muted">
        {approval.description}
      </Text>
      {approval.toolName ? (
        <Text className="font-mono text-[11px] text-muted">
          {approval.toolName}
        </Text>
      ) : null}
      {canResolve ? (
        <View className="flex-row gap-two pt-one">
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onPress("approve")}
            size="sm"
          >
            {resolve.isPending ? "Working…" : "Approve"}
          </Button>
          <Button
            isDisabled={resolve.isPending}
            onPress={() => onPress("reject")}
            size="sm"
            variant="secondary"
          >
            Reject
          </Button>
        </View>
      ) : (
        <Text className="text-xs text-muted">
          {resolverLabel(approval.resolver, approval.resolverUserName)}
        </Text>
      )}
    </View>
  )
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
    <View className="pt-two">
      <ApprovalGateCard approval={approval} channelId={channelId} />
    </View>
  )
}
