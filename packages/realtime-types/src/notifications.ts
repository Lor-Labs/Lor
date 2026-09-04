export type NotificationConversationContext = {
  channelName: string | null
  workspaceName: string | null
}

export type MerlinThreadNotificationPreference =
  | "all_activity"
  | "subscribed_only"

export type MerlinThreadNotificationContext = {
  threadRootId: string | null
  isMerlinThread: boolean
  isSubscribedToThread: boolean
}

export function shouldNotifyForMerlinThread(
  preference: MerlinThreadNotificationPreference,
  context: MerlinThreadNotificationContext
): boolean {
  return (
    !context.isMerlinThread ||
    preference === "all_activity" ||
    context.isSubscribedToThread
  )
}

export function buildNotificationConversationName(
  context: NotificationConversationContext
): string | null {
  const channelName = context.channelName ? `#${context.channelName}` : null

  if (channelName && context.workspaceName) {
    return `${channelName}, ${context.workspaceName}`
  }
  return channelName ?? context.workspaceName
}

export function buildNotificationTitle(input: {
  actorName: string
  channelName: string | null
  workspaceName: string | null
}): string {
  const conversationName = buildNotificationConversationName(input)
  return conversationName
    ? `${input.actorName} (${conversationName})`
    : input.actorName
}

export function buildReactionNotificationBody(input: {
  emoji: string
  messagePreview: string | null
}): string {
  return input.messagePreview
    ? `Reacted ${input.emoji} to your "${input.messagePreview}"`
    : `Reacted ${input.emoji} to your message`
}

// One wording for the proposal ping on every surface (web/desktop OS
// notification, mobile push) — pillar 3.
export function buildProposalNotificationContent(input: {
  channelName: string | null
  workspaceName: string
  rationale: string
}): { title: string; body: string } {
  const where = input.channelName
    ? `#${input.channelName}`
    : input.workspaceName
  const rationale = input.rationale.trim()
  return {
    title: `Merlin proposed workspace changes in ${where}`,
    body:
      rationale.length > 140
        ? `${rationale.slice(0, 140)}…`
        : rationale || "Review the proposal card to approve or reject it.",
  }
}

// One wording for the approval ping on every surface (web/desktop OS
// notification, mobile push) — LOR-83.
export function buildApprovalNotificationContent(input: {
  flavor: "actionable" | "waiting"
  channelName: string | null
  workspaceName: string
  description: string
  resolverLabel: string
}): { title: string; body: string } {
  const where = input.channelName
    ? `#${input.channelName}`
    : input.workspaceName
  if (input.flavor === "waiting") {
    return {
      title: `Merlin is waiting for approval in ${where}`,
      body: `Needs ${input.resolverLabel}: ${input.description}`,
    }
  }
  return {
    title: `Merlin needs your approval in ${where}`,
    body: input.description,
  }
}
