import { z } from "zod"
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./uploads"

export type PresenceStatus = "online" | "offline" | "idle" | "dnd"
export const PRESENCE_ONLINE_USERS_SET_KEY = "presence:online-users"

export const presenceSubscribePayloadSchema = z.object({
  workspaceId: z.string().uuid(),
})

export const channelRoomPayloadSchema = z.object({
  channelId: z.string().uuid(),
})

export const threadRoomPayloadSchema = z.object({
  threadRootId: z.string().uuid(),
})

// No pre-existing user-message length limit in the repo (webhooks use 2000,
// Merlin posts 8000); 20000 is a generous cap to bound realtime payloads.
export const MESSAGE_CONTENT_MAX_LENGTH = 20000

export const attachmentPayloadSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(256),
  size: z.number().int().min(1),
  contentType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const sendMessagePayloadSchema = z
  .object({
    channelId: z.string().uuid(),
    content: z.string().trim().max(MESSAGE_CONTENT_MAX_LENGTH).optional(),
    nonce: z.string().max(100).optional(),
    referencedMessageId: z.string().uuid().optional(),
    threadRootId: z.string().uuid().optional(),
    attachments: z
      .array(attachmentPayloadSchema)
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
  })
  .refine(
    (data) =>
      (data.content && data.content.length > 0) ||
      (data.attachments && data.attachments.length > 0),
    { message: "Message must have content or at least one attachment" }
  )

export const toggleMessageReactionPayloadSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
  emoji: z.string().trim().min(1).max(64),
})

export const deleteMessagePayloadSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
})

export const editMessagePayloadSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX_LENGTH),
})

export const markChannelReadPayloadSchema = z.object({
  channelId: z.string().uuid(),
  lastReadMessageId: z.string().uuid().optional(),
})

export type ChannelRoomPayload = z.infer<typeof channelRoomPayloadSchema>
export type ThreadRoomPayload = z.infer<typeof threadRoomPayloadSchema>
export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>
export type ToggleMessageReactionPayload = z.infer<
  typeof toggleMessageReactionPayloadSchema
>
export type DeleteMessagePayload = z.infer<typeof deleteMessagePayloadSchema>
export type EditMessagePayload = z.infer<typeof editMessagePayloadSchema>
export type MarkChannelReadPayload = z.infer<
  typeof markChannelReadPayloadSchema
>
export type PresenceSubscribePayload = z.infer<
  typeof presenceSubscribePayloadSchema
>

type OkResult = { ok: true }
type ErrorResult = { ok: false; error: string }

export type JoinLeaveAck = (result: OkResult | ErrorResult) => void

export type RealtimeMessageType =
  | "default"
  | "reply"
  | "system_join"
  | "system_leave"
  | "system_pin"
  | "channel_name_change"
  | "task_card"
  | "loop_card"

export type RealtimeAuthor = {
  id: string
  name: string
  username: string | null
  displayUsername: string | null
  image: string | null
  avatarColor?: string | null
}

export type RealtimeMessageMention = RealtimeAuthor

export type RealtimeMessageReaction = {
  emoji: string
  count: number
  reactedByCurrentUser: boolean
  reactors: Array<{ id: string; name: string }>
}

export type RealtimeAttachment = {
  url: string
  filename: string
  size: number
  contentType: string
  width?: number
  height?: number
}

export type RealtimeEmbed = {
  type: "link" | "image" | "video" | "rich"
  url?: string
  title?: string
  description?: string
  eventLabel?: string
  thumbnail?: string
  siteName?: string
  author?: { name: string; url?: string; iconUrl?: string }
  fields?: { name: string; value: string; inline?: boolean }[]
  image?: string
  footer?: string
  timestamp?: string
  color?: string
}

export type RealtimeReferencedMessage = {
  id: string
  content: string | null
  author: RealtimeAuthor
  // Webhook/connector display identity — mirrors RealtimeMessage so reply
  // previews show the same name/avatar as the referenced message itself.
  overrideName: string | null
  overrideAvatarUrl: string | null
  // Users mentioned in `content`, so a reply preview can resolve stored
  // `<@uuid>` tokens to names instead of leaking raw ids. Optional: optimistic
  // sends and older payloads omit it.
  mentions?: RealtimeAuthor[]
}

export type RealtimeMessage = {
  id: string
  channelId: string
  // message:send currently emits non-null content; null is reserved for
  // system/attachment-only message shapes from persisted history.
  content: string | null
  type: RealtimeMessageType
  pinned: boolean
  createdAt: string
  author: RealtimeAuthor
  mentions: RealtimeMessageMention[]
  reactions: RealtimeMessageReaction[]
  attachments: RealtimeAttachment[]
  embeds: RealtimeEmbed[]
  referencedMessage: RealtimeReferencedMessage | null
  threadRootId?: string | null
  editedAt?: string
  nonce?: string
  // Display identity for webhook/connector messages — overrides the author's
  // name/avatar when set (the row is authored by the shared app bot user).
  overrideName?: string | null
  overrideAvatarUrl?: string | null
  // Set on Merlin's empty placeholder so the client shows the "thinking"
  // indicator immediately, without waiting for the first stream event.
  streaming?: boolean
  // Row lifecycle — "pending" on an in-flight Merlin placeholder, so the
  // thinking indicator persists across a reload/late thread join (not just the
  // transient `streaming` flag). Absent → treated as "complete".
  status?: "complete" | "pending" | "failed"
  // The human message that started this Merlin response. Present only on
  // Merlin placeholders so chat scrollers can anchor the start of the turn.
  merlinTriggerMessageId?: string | null
}

export type RealtimeMessagePinToggled = {
  channelId: string
  messageId: string
  pinned: boolean
}

export type RealtimeMessageEmbedsUpdated = {
  channelId: string
  messageId: string
  embeds: RealtimeEmbed[]
}

export type RealtimeMessageReactionUpdated = {
  channelId: string
  messageId: string
  emoji: string
  count: number
  actorUserId: string
  actorName: string
  reactedByActor: boolean
}

// Lightweight update for the channel-feed footer when a thread gets a reply.
// Carries enough for the receiver to refresh the root's threadSummary without
// re-fetching the channel feed. `replyCount: 0` + `lastReplyAt: null` signals
// the thread is now empty (last reply deleted) so the footer can be cleared.
export type RealtimeMessageThreadUpdated = {
  channelId: string
  threadRootId: string
  replyCount: number
  lastReplyAt: string | null
  participants: Array<{
    id: string
    name: string
    displayUsername: string | null
    image: string | null
    avatarColor?: string | null
  }>
  // Preview of the newest reply, for the channel-feed activity card. Null when
  // the thread is empty (last reply deleted).
  lastReply: {
    content: string | null
    author: RealtimeAuthor
    mentions: RealtimeMessageMention[]
    hasAttachments: boolean
  } | null
}

export type SendMessageAck = (
  result: { ok: true; message: RealtimeMessage } | ErrorResult
) => void

export type DeleteMessageAck = (result: OkResult | ErrorResult) => void
export type EditMessageAck = (
  result:
    | { ok: true; editedAt: string; mentions: RealtimeMessageMention[] }
    | ErrorResult
) => void

export type ToggleMessageReactionAck = (
  result: { ok: true; update: RealtimeMessageReactionUpdated } | ErrorResult
) => void

export type ChannelReadState = {
  channelId: string
  lastReadMessageId: string | null
  lastReadAt: string
  unreadCount: number
  mentionCount: number
}

export type MarkChannelReadAck = (
  result: { ok: true; state: ChannelReadState } | ErrorResult
) => void

export type PresenceSnapshot = {
  workspaceId: string
  onlineUserIds: string[]
}

export type PresenceSubscribeAck = (
  result: { ok: true; snapshot: PresenceSnapshot } | ErrorResult
) => void

export type PresenceUserUpdate = {
  workspaceId: string
  userId: string
  status: PresenceStatus
}

export type UnreadNotification = {
  channelId: string
  workspaceId: string | null
  messageId: string
  threadRootId: string | null
  isMerlinThread: boolean
  isSubscribedToThread: boolean
  unreadCountDelta: number
  authorUserId: string
  authorName: string
  authorImage: string | null
  contentPreview: string | null
  channelName: string | null
  workspaceName: string | null
}

export type ReactionNotification = {
  channelId: string
  workspaceId: string | null
  messageId: string
  threadRootId: string | null
  emoji: string
  actorUserId: string
  actorName: string
  actorImage: string | null
  channelName: string | null
  workspaceName: string | null
  messagePreview: string | null
}

export type MentionNotification = {
  id: string
  type: "direct_mention" | "everyone_mention"
  messageId: string
  channelId: string
  workspaceId: string | null
  threadRootId: string | null
  isMerlinThread: boolean
  isSubscribedToThread: boolean
  createdAt: string
}

// Sent to the user room when a channel mute is set/cleared on any device, so
// other clients refresh their mute list immediately.
export type ChannelMuteUpdated = {
  channelId: string
  mutedUntil: string | null
  muted: boolean
}

// Wire shape of a Merlin tool-trail entry — mirrors MerlinToolCall in
// @repo/db/schema. Shared by merlin:tool and project:archive:progress.
export type RealtimeMerlinToolCall = {
  toolCallId: string
  toolName: string
  label: string
  at?: number
  order?: number
  parentToolCallId?: string
  detail?: {
    summary?: string
    items?: { title: string; url?: string }[]
  }
  diff?: {
    path: string
    additions: number
    deletions: number
    patch?: string
    truncated?: boolean
  }
  files?: {
    artifactId: string
    path: string
    contentType: string
    size: number
    url: string
  }[]
  status?: "ok" | "error"
}

// Project lifecycle change (archive start/finish). Emitted to the audience's
// user rooms — never the workspace room — so a private project's existence
// doesn't leak to non-members. Clients refetch projects/channels on receipt.
export type ProjectUpdatedEvent = {
  projectId: string
  categoryChannelId: string
  status: "active" | "archiving" | "archived"
  archivedAt: string | null
}

// Live archive-synthesis progress (tool call or memory write), emitted to the
// project's CATEGORY channel room — the archived-project overview joins it
// via the normal channel:join access check. Ephemeral: the durable record
// lands on the project row when the run finishes.
export type ProjectArchiveProgressEvent = {
  projectId: string
  categoryChannelId: string
  toolCall?: RealtimeMerlinToolCall
  memory?: { nodeId?: string; path: string; action: "created" | "updated" }
}

export type NotificationBootstrap = {
  readStates: Array<{
    channelId: string
    unreadCount: number
    mentionCount: number
    lastReadMessageId: string | null
  }>
}

export const workspaceMemberJoinedPayloadSchema = z.object({
  workspaceId: z.string().uuid(),
})

export type WorkspaceMemberJoinedPayload = z.infer<
  typeof workspaceMemberJoinedPayloadSchema
>

export type WorkspaceMemberJoinedEvent = {
  workspaceId: string
  userId: string
  name: string
  username: string | null
  image: string | null
}

export type WorkspaceMemberJoinedAck = (result: OkResult | ErrorResult) => void

export const typingStartPayloadSchema = z.object({
  channelId: z.string().uuid(),
  // Set when typing inside a thread reply so the indicator scopes to the
  // thread panel instead of leaking into the main channel.
  threadRootId: z.string().uuid().optional(),
})

export type TypingStartPayload = z.infer<typeof typingStartPayloadSchema>

export type TypingIndicatorEvent = {
  channelId: string
  threadRootId?: string | null
  userId: string
  name: string
}

export interface ClientToServerEvents {
  "presence:subscribe": (
    payload: PresenceSubscribePayload,
    ack?: PresenceSubscribeAck
  ) => void
  "channel:join": (payload: ChannelRoomPayload, ack?: JoinLeaveAck) => void
  "channel:leave": (payload: ChannelRoomPayload, ack?: JoinLeaveAck) => void
  "thread:join": (payload: ThreadRoomPayload, ack?: JoinLeaveAck) => void
  "thread:leave": (payload: ThreadRoomPayload, ack?: JoinLeaveAck) => void
  "message:send": (payload: SendMessagePayload, ack?: SendMessageAck) => void
  "message:delete": (
    payload: DeleteMessagePayload,
    ack?: DeleteMessageAck
  ) => void
  "message:edit": (payload: EditMessagePayload, ack?: EditMessageAck) => void
  "message:reaction:toggle": (
    payload: ToggleMessageReactionPayload,
    ack?: ToggleMessageReactionAck
  ) => void
  "channel:mark-read": (
    payload: MarkChannelReadPayload,
    ack?: MarkChannelReadAck
  ) => void
  "workspace:member:joined": (
    payload: WorkspaceMemberJoinedPayload,
    ack?: WorkspaceMemberJoinedAck
  ) => void
  "typing:start": (payload: TypingStartPayload) => void
}

export interface ServerToClientEvents {
  "presence:ready": (payload: {
    userId: string
    rooms: {
      user: string
      workspaces: string[]
    }
  }) => void
  "presence:user:update": (payload: PresenceUserUpdate) => void
  "message:created": (payload: RealtimeMessage) => void
  "message:deleted": (payload: { channelId: string; messageId: string }) => void
  "message:updated": (payload: {
    channelId: string
    messageId: string
    content: string
    editedAt: string
    mentions: RealtimeMessageMention[]
  }) => void
  "message:reaction:updated": (payload: RealtimeMessageReactionUpdated) => void
  "message:embeds:updated": (payload: RealtimeMessageEmbedsUpdated) => void
  // Merlin streaming its reply into an existing (placeholder) message.
  // delta = new text chunk; done = final chunk (content now persisted in DB).
  // threadRootId is set when Merlin's reply lives in a thread (else null), so
  // the client patches the right message cache.
  "message:stream": (payload: {
    channelId: string
    threadRootId: string | null
    messageId: string
    delta: string
    done: boolean
    // Durable-run identity + event-log sequence number for this frame, so a
    // client can replay persisted events (GET run events ?after=seq) and then
    // drain buffered live frames without gaps or reordering. Absent on frames
    // from a run that predates the event log.
    runId?: string
    seq?: number
    // Terminal status on the final chunk, so the client clears the
    // placeholder's "pending" state live (not just on reload).
    status?: "complete" | "failed"
    // When set, `delta` replaces the message content instead of appending —
    // used on failure to drop a partial answer in favor of the fallback text.
    replace?: boolean
    // Resolved @mentions Merlin made, sent on the terminal (done) chunk so the
    // client highlights them live — mirrors the messageMention rows persisted
    // for reload. Absent while streaming (the users aren't resolved until then).
    mentions?: RealtimeMessageMention[]
  }) => void
  // Merlin's summarized extended-thinking, streamed before/between the answer.
  // `at` and `order` place each segment among answer text and tool calls.
  "merlin:reasoning": (payload: {
    channelId: string
    threadRootId: string | null
    messageId: string
    delta: string
    at: number
    order: number
    runId?: string
    seq?: number
  }) => void
  // Merlin saved/updated a brain page during write-back (messageId = its reply).
  "merlin:memory": (payload: {
    channelId: string
    threadRootId: string | null
    messageId: string
    path: string
    action: "created" | "updated"
    nodeId?: string
    runId?: string
    seq?: number
  }) => void
  // Merlin invoked a tool mid-answer (search, fetch, …). Sent on call (label
  // only) and again on completion (with detail + status). The client upserts it
  // into the message's tool trail by toolCallId; the same trail is persisted on
  // the message for reload. Mirrors MerlinToolCall in @repo/db/schema.
  "merlin:tool": (payload: {
    channelId: string
    threadRootId: string | null
    messageId: string
    toolCall: RealtimeMerlinToolCall
    runId?: string
    seq?: number
  }) => void
  // A mid-run send was routed at the scope's active run instead of starting a
  // new one: steered (injected at the next step boundary) or queued (answered
  // by the follow-up run when the scope frees up).
  "message:routed": (payload: MessageRoutedEvent) => void
  // A steered message was injected into the running answer — the placeholder
  // shows "applying new direction".
  "merlin:steer": (payload: MerlinSteerEvent) => void
  // A queued message left the queue (drained into a follow-up run, rejected at
  // reauthorization, or withdrawn by its sender) — clients drop it from the
  // queued-messages pill. Additions ride message:routed (outcome "queued").
  "run:queue:updated": (payload: RunQueueUpdatedEvent) => void

  // Task snapshot changed (status, plan, summary). Channel room.
  "task:updated": (payload: TaskUpdatedEvent) => void
  "message:pin:toggled": (payload: RealtimeMessagePinToggled) => void
  "message:thread:updated": (payload: RealtimeMessageThreadUpdated) => void
  "notification:bootstrap": (payload: NotificationBootstrap) => void
  "notification:unread": (payload: UnreadNotification) => void
  "notification:mention": (payload: MentionNotification) => void
  "notification:reaction": (payload: ReactionNotification) => void
  "channel:read-state": (payload: ChannelReadState) => void
  "channel-mute:updated": (payload: ChannelMuteUpdated) => void
  "project:updated": (payload: ProjectUpdatedEvent) => void
  "project:archive:progress": (payload: ProjectArchiveProgressEvent) => void
  "workspace:member:joined": (payload: WorkspaceMemberJoinedEvent) => void
  "typing:update": (payload: TypingIndicatorEvent) => void
  "billing:updated": (payload: BillingUpdatedEvent) => void
  "instructions:proposal": (payload: InstructionsProposalUpdate) => void
}

// Emitted to the workspace room when Merlin files a workspace-instructions
// proposal; clients refresh the instructions query so admins see the
// approval alert immediately.
export type InstructionsProposalUpdate = {
  workspaceId: string
  version: number
}

export type MessageRoutedEvent = {
  channelId: string
  threadRootId: string | null
  messageId: string
  outcome: "steered" | "queued"
  runId: string
  // The active run's placeholder message — where the run-state chip lives.
  merlinMessageId: string
}

export type RunQueueUpdatedEvent = {
  channelId: string
  threadRootId: string | null
  // The queued (user) message that left the queue.
  messageId: string
  state: "consumed" | "rejected" | "cancelled"
}

export type RealtimeTaskStatus =
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "stopped"

export type RealtimeTaskPlanItem = {
  text: string
  status: "pending" | "active" | "done"
  description?: string
}

// Snapshot of a task, emitted to the channel room on every status,
// plan, or summary change — the task card and header chip render from it.
export type RealtimeTask = {
  id: string
  workspaceId: string
  channelId: string
  cardMessageId: string
  creatorId: string | null
  title: string
  goal: string
  status: RealtimeTaskStatus
  plan: RealtimeTaskPlanItem[]
  summary: string | null
  activeRunId: string | null
  createdAt: string
  updatedAt: string
}

export type TaskUpdatedEvent = {
  task: RealtimeTask
}

export type MerlinSteerEvent = {
  channelId: string
  threadRootId: string | null
  // The placeholder being answered into.
  messageId: string
  steeredMessageId: string
  authorName: string
  runId?: string
  seq?: number
}

// Emitted to the workspace room; clients invalidate their billing query and
// gate any toast presentation to admins client-side.
export type BillingUpdatedEvent = {
  workspaceId: string
  reason:
    | "auto_topup_succeeded"
    | "auto_topup_failed"
    | "low_balance"
    | "out_of_credits"
    | "subscription_changed"
}

export type InterServerEvents = Record<string, never>
