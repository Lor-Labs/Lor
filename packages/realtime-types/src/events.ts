import { z } from "zod"
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./uploads"

export type PresenceStatus = "online" | "offline" | "idle" | "dnd"
export const PRESENCE_ONLINE_USERS_SET_KEY = "presence:online-users"

export const presenceSubscribePayloadSchema = z.object({
  workspaceId: z.string().uuid(),
})

// A sidebar session's state, strongest first: needs_you (an approval or a
// question from Lor), running, unread, idle.
export type SidebarSessionState = "needs_you" | "running" | "unread" | "idle"

export type SidebarSession = {
  id: string
  title: string
  // A person renamed it. Only Lor's generated titles type out on web.
  titleEdited: boolean
  state: SidebarSessionState
  loop: boolean
  lastActivityAt: string
}

export type ChannelActivity = {
  channelId: string
  // Every Lor run in the channel. Mobile reads it until its session rows land.
  lor: "working" | "queued" | "needs_input" | "needs_approval" | null
  // The caller's subscribed, unarchived sessions here, newest activity first.
  sessions: SidebarSession[]
}

export type WorkspaceActivityAck = (
  result: { ok: true; channels: ChannelActivity[] } | ErrorResult
) => void

export type WorkspaceActivityUpdated = {
  workspaceId: string
}

// Invalidation only: clients refetch the authorized presence snapshot.
export type WorkspaceVoiceUpdated = {
  workspaceId: string
}

// The call a user is connected to on any device, or null. Sent to the user's
// room so their other devices can offer "Transfer here".
export type VoiceCallState = {
  sessionId: string
  channelId: string
  channelName: string | null
  workspaceId: string
  workspaceSlug: string
}

// Wire shape of what Lor's window shows. Mirrors VoiceBlock in
// @repo/db/schema.
export type RealtimeVoiceBlock =
  | { type: "answer"; markdown: string }
  | { type: "question"; prompt: string; choices: string[] }
  | {
      type: "list"
      title: string | null
      items: { title: string; detail: string | null; url: string | null }[]
    }
  | {
      type: "table"
      title: string | null
      columns: string[]
      rows: string[][]
    }
  | {
      type: "details"
      title: string | null
      fields: { label: string; value: string }[]
    }
  | { type: "linear_issues"; title: string | null; issues: string[] }
  | {
      type: "github_pull_requests"
      title: string | null
      pullRequests: string[]
    }

// Something said to Lor in a live call. Sent to the session chat's thread
// room, so only people in the call receive it (live-only rule).
export type VoiceRequestState = {
  id: string
  sessionId: string
  participantId: string
  userId: string
  heardText: string
  status:
    | "listening"
    | "rejected"
    | "queued"
    | "working"
    | "awaiting_approval"
    | "done"
    | "failed"
    | "cancelled"
  result: { blocks: RealtimeVoiceBlock[] } | null
  // Set while the request waits on an approval.
  approval: {
    approvalId: string
    label: string
    toolName: string
    approvers: { userId: string; name: string }[]
  } | null
  finishedAt: string | null
  // Someone cleared the finished result from Lor's window.
  dismissedAt: string | null
  // Someone brought this result back into Lor's window.
  stagedAt: string | null
  createdAt: string
  updatedAt: string
}

// While a request runs: a tool Lor started, and a reaction it chose. Live
// only, to the session chat's thread room.
export type VoiceRequestActivity = {
  sessionId: string
  requestId: string
  toolName: string
}

export type VoiceRequestReaction = {
  sessionId: string
  requestId: string
  emoji: string
}

export const channelRoomPayloadSchema = z.object({
  channelId: z.string().uuid(),
})

export const threadRoomPayloadSchema = z.object({
  threadRootId: z.string().uuid(),
})

// No pre-existing user-message length limit in the repo (webhooks use 2000,
// Lor posts 8000); 20000 is a generous cap to bound realtime payloads.
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
    // Session composer switched to "To people": Lor doesn't run and nobody
    // is pinged.
    toPeople: z.boolean().optional(),
    // New session view: the message starts a session in this channel with
    // no chat context, @Lor or not.
    startSession: z.boolean().optional(),
    // Ids the sender chose for the session this send starts (New session or
    // @Lor), so it can show the session before the ack. Ignored when the
    // send starts none.
    newSession: z
      .object({ id: z.string().uuid(), threadRootId: z.string().uuid() })
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
  | "event"
  | "plan_card"
  | "loop_card"
  | "loop_fire"
  | "proposal_card"
  | "voice_session"
  | "call_summary"
  | "agent_session"

// Mirrors channel_event_type / ChannelEventPayload in @repo/db (messages.ts) —
// hand-copied like RealtimeMessageType so clients don't pull in drizzle.
export type RealtimeChannelEventType =
  | "channel_created"
  | "channel_renamed"
  | "member_added"
  | "member_removed"
  | "member_left"
  | "loop_created"
  | "loop_paused"
  | "loop_completed"
  | "loop_run"
  | "trigger_run"

export type RealtimeChannelEventPayload =
  | { via?: "proposal"; originChannelId?: string; originChannelName?: string }
  | { from: string; to: string }
  | { userIds: string[] }
  | { userId: string }
  | {
      loopId: string
      loopName: string
      reason?: "failures" | "out_of_credits"
      via?: "proposal"
    }
  | { triggerId: string; label: string }
  | null

export type RealtimeAuthor = {
  id: string
  name: string
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
  // Set only when type = "event" — the channel-event kind and its structured
  // copy data (see @repo/db ChannelEventPayload).
  eventType?: RealtimeChannelEventType | null
  eventPayload?: RealtimeChannelEventPayload
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
  // Set on Lor's empty placeholder so the client shows the "thinking"
  // indicator immediately, without waiting for the first stream event.
  streaming?: boolean
  // Row lifecycle — "pending" on an in-flight Lor placeholder, so the
  // thinking indicator persists across a reload/late thread join (not just the
  // transient `streaming` flag). Absent → treated as "complete".
  status?: "complete" | "pending" | "failed"
  // The human message that started this Lor response. Present only on
  // Lor placeholders so chat scrollers can anchor the start of the turn.
  lorTriggerMessageId?: string | null
  // A person's session message: whether it went to Lor. false = for channel
  // members only. Null outside sessions.
  routedToLor?: boolean | null
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
  // Set when the thread is a Lor session; the chat's thread-activity dock
  // skips sessions (their sidebar row shows activity).
  sessionId?: string | null
  replyCount: number
  lastReplyAt: string | null
  // The thread is blocked on a human — a pending approval or an open plan
  // waiting for input. Drives the amber chip on channel-feed thread footers.
  lorWaiting: "needs_approval" | "needs_input" | null
  participants: Array<{
    id: string
    name: string
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
  // The full reply message, present only when this update is a reply being
  // created (absent for edit/delete recomputes). Lets clients with a cached
  // copy of the thread inject the reply directly instead of refetching —
  // the thread room only delivers `message:created` while the panel is open.
  reply?: RealtimeMessage
}

export type SendMessageAck = (
  result:
    | {
        ok: true
        message: RealtimeMessage
        // The Lor session this message is in, when it is in one.
        session?: RealtimeAgentSession
      }
    | ErrorResult
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
  firstUnreadMessageId?: string | null
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
  messageType?: RealtimeMessageType
  threadRootId: string | null
  // Whether this recipient gets an OS or push notification. Thread messages
  // notify only the thread's subscribers, and Lor finishing in a session only
  // its starter. Badges count the message either way.
  notify: boolean
  // Set when the message is in a Lor session (opens the session page).
  sessionId: string | null
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
  // Set when the mention is in a Lor session: it alerts on the session's
  // sidebar row, not the channel's mention badge.
  sessionId: string | null
  createdAt: string
  // Set when the mention is in a live call's chat the person isn't in: they
  // get who and where, never the message, and threadRootId is null.
  callMention?: { authorName: string; channelName: string | null }
}

// Sent to the user room when the user reads a thread on any device (opened
// the panel or dismissed its activity blob), so other clients drop it from
// the thread-activity dock immediately.
export type ThreadReadUpdated = {
  channelId: string
  threadRootId: string
  lastReadAt: string
}

// Sent to the user room when a channel mute is set/cleared on any device, so
// other clients refresh their mute list immediately.
export type ChannelMuteUpdated = {
  channelId: string
  mutedUntil: string | null
  muted: boolean
}

// A product hint the user dismissed on another device; key is a `hint_key`.
export type HintDismissed = {
  key: string
}

// Wire shape of a Lor tool-trail entry — mirrors LorToolCall in
// @repo/db/schema. Shared by lor:tool and project:archive:progress.
export type RealtimeLorToolCall = {
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

// Payloads for the lor:* streaming events.
export type LorReasoningEventPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  delta: string
  at: number
  order: number
  runId?: string
  seq?: number
}

export type LorMemoryEventPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  path: string
  action: "created" | "updated"
  nodeId?: string
  runId?: string
  seq?: number
}

export type LorToolEventPayload = {
  channelId: string
  threadRootId: string | null
  messageId: string
  toolCall: RealtimeLorToolCall
  runId?: string
  seq?: number
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
  toolCall?: RealtimeLorToolCall
  memory?: { nodeId?: string; path: string; action: "created" | "updated" }
}

export type NotificationBootstrap = {
  readStates: Array<{
    channelId: string
    unreadCount: number
    mentionCount: number
    lastReadMessageId: string | null
    firstUnreadMessageId?: string | null
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
  "workspace:activity": (
    payload: PresenceSubscribePayload,
    ack: WorkspaceActivityAck
  ) => void
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
  "workspace:activity:updated": (payload: WorkspaceActivityUpdated) => void
  "workspace:voice:updated": (payload: WorkspaceVoiceUpdated) => void
  "voice:call:updated": (payload: { call: VoiceCallState | null }) => void
  "voice:request:updated": (payload: { request: VoiceRequestState }) => void
  "voice:request:activity": (payload: VoiceRequestActivity) => void
  "voice:request:reaction": (payload: VoiceRequestReaction) => void
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
  // Lor streaming its reply into an existing (placeholder) message.
  // delta = new text chunk; done = final chunk (content now persisted in DB).
  // threadRootId is set when Lor's reply lives in a thread (else null), so
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
    // Resolved @mentions Lor made, sent on the terminal (done) chunk so the
    // client highlights them live — mirrors the messageMention rows persisted
    // for reload. Absent while streaming (the users aren't resolved until then).
    mentions?: RealtimeMessageMention[]
  }) => void
  // Lor's summarized extended-thinking, streamed before/between the answer.
  // `at` and `order` place each segment among answer text and tool calls.
  "lor:reasoning": (payload: LorReasoningEventPayload) => void
  // Lor saved/updated a brain page during write-back (messageId = its reply).
  "lor:memory": (payload: LorMemoryEventPayload) => void
  // Lor invoked a tool mid-answer (search, fetch, …). Sent on call (label
  // only) and again on completion (with detail + status). The client upserts it
  // into the message's tool trail by toolCallId; the same trail is persisted on
  // the message for reload. Mirrors LorToolCall in @repo/db/schema.
  "lor:tool": (payload: LorToolEventPayload) => void
  // A mid-run send was routed at the scope's active run instead of starting a
  // new one: steered (injected at the next step boundary) or queued (answered
  // by the follow-up run when the scope frees up).
  "message:routed": (payload: MessageRoutedEvent) => void
  // A steered message was injected into the running answer — the placeholder
  // shows "applying new direction".
  "lor:steer": (payload: LorSteerEvent) => void
  // A queued message left the queue (drained into a follow-up run, rejected at
  // reauthorization, or withdrawn by its sender) — clients drop it from the
  // queued-messages pill. Additions ride message:routed (outcome "queued").
  "run:queue:updated": (payload: RunQueueUpdatedEvent) => void

  // Plan snapshot changed (status, steps, summary). Channel room.
  "plan:updated": (payload: PlanUpdatedEvent) => void
  // Lor session row changed (title, archive, activity). Channel room.
  "session:updated": (payload: AgentSessionUpdatedEvent) => void
  // A run parked on an approval gate. Channel room; ids only — the
  // durable card data comes from the channel approvals query this invalidates.
  "approval:created": (payload: ApprovalCreatedEvent) => void
  // An approval was resolved. Channel room when the approval belongs
  // to a channel scope, so open approval cards settle without a refetch.
  "approval:updated": (payload: ApprovalUpdatedEvent) => void
  // A change proposal was resolved or applied (pillar 3). Channel room; ids
  // only — cards refetch the durable rows.
  "proposal:updated": (payload: ProposalUpdatedEvent) => void
  // Loop snapshot changed (status, schedule, run bookkeeping). Channel room.
  "loop:updated": (payload: LoopUpdatedEvent) => void
  // Loop hard-deleted (its card message goes separately via message:deleted).
  "loop:deleted": (payload: { loopId: string; channelId: string }) => void
  "message:pin:toggled": (payload: RealtimeMessagePinToggled) => void
  "message:thread:updated": (payload: RealtimeMessageThreadUpdated) => void
  "notification:bootstrap": (payload: NotificationBootstrap) => void
  "notification:unread": (payload: UnreadNotification) => void
  "notification:mention": (payload: MentionNotification) => void
  "notification:reaction": (payload: ReactionNotification) => void
  // User room, resolver-targeted (LOR-83): a run parked on an approval gate
  // and this user should act (or know). Online clients show an OS
  // notification; the offline complement goes out as a mobile push instead.
  "notification:approval": (payload: ApprovalNotification) => void
  // A change proposal awaits someone whose permissions cover it. User room.
  "notification:proposal": (payload: ProposalNotification) => void
  // Someone added this user as a subscriber to a session or thread. User room.
  "notification:subscribed": (payload: SubscribedNotification) => void
  "notification:call-summary": (payload: CallSummaryNotification) => void
  "channel:read-state": (payload: ChannelReadState) => void
  "channel:created": (payload: ChannelCreatedEvent) => void
  "channel-mute:updated": (payload: ChannelMuteUpdated) => void
  "hint:dismissed": (payload: HintDismissed) => void
  "thread-read:updated": (payload: ThreadReadUpdated) => void
  "project:updated": (payload: ProjectUpdatedEvent) => void
  "project:archive:progress": (payload: ProjectArchiveProgressEvent) => void
  "workspace:member:joined": (payload: WorkspaceMemberJoinedEvent) => void
  "typing:update": (payload: TypingIndicatorEvent) => void
  "billing:updated": (payload: BillingUpdatedEvent) => void
  "instructions:proposal": (payload: InstructionsProposalUpdate) => void
  "instructions:updated": (payload: InstructionsProposalUpdate) => void
}

export type ChannelCreatedEvent = {
  workspaceId: string
  channelId: string
}

// Emitted to the workspace room when Lor files a workspace-instructions
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
  lorMessageId: string
}

export type RunQueueUpdatedEvent = {
  channelId: string
  threadRootId: string | null
  // The queued (user) message that left the queue.
  messageId: string
  state: "consumed" | "rejected" | "cancelled"
}

export type RealtimePlanStatus =
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "stopped"

export type RealtimePlanStep = {
  text: string
  status: "pending" | "active" | "done"
  description?: string
}

// Snapshot of a plan, emitted to the channel room on every status,
// steps, or summary change — the plan card and header chip render from it.
export type RealtimePlan = {
  id: string
  workspaceId: string
  channelId: string
  // The thread root the plan's runs execute under — the plan's conversation.
  threadRootId: string
  // The projected card message in the channel feed; equals threadRootId for
  // spawned (card-as-root) plans, null only if the card was deleted.
  cardMessageId: string | null
  creatorId: string | null
  title: string
  goal: string
  status: RealtimePlanStatus
  steps: RealtimePlanStep[]
  summary: string | null
  activeRunId: string | null
  createdAt: string
  updatedAt: string
}

export type PlanUpdatedEvent = {
  plan: RealtimePlan
}

export type RealtimeAgentSessionOrigin = "chat" | "new" | "loop" | "trigger"

// Snapshot of a Lor session row. Mirrors agent_session in @repo/db; guarded
// in @repo/lor.
export type RealtimeAgentSession = {
  id: string
  workspaceId: string
  channelId: string
  threadRootId: string
  creatorId: string | null
  origin: RealtimeAgentSessionOrigin
  title: string
  titleEditedAt: string | null
  loopId: string | null
  triggerId: string | null
  archivedAt: string | null
  archivedById: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

export type AgentSessionUpdatedEvent = {
  session: RealtimeAgentSession
}

export type RealtimeApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"

// "actionable" = this user can resolve the approval; "waiting" = this user's
// own run is blocked on someone else (informational).
export type ApprovalNotification = {
  approvalId: string
  flavor: "actionable" | "waiting"
  workspaceId: string
  workspaceName: string
  channelId: string
  channelName: string | null
  threadRootId: string | null
  messageId: string | null
  description: string
  // Plain words for who can resolve ("anyone in the channel", "the support
  // role", a person's name) — rendered in the waiting flavor.
  resolverLabel: string
}

export type ProposalUpdatedEvent = {
  proposalId: string
  channelId: string
  status: "pending" | "approved" | "rejected" | "applied" | "failed"
}

// User-targeted ping to people whose permissions cover a new proposal —
// online clients render the OS notification, offline ones get the push.
export type ProposalNotification = {
  proposalId: string
  workspaceId: string
  workspaceName: string
  channelId: string
  channelName: string | null
  // The session the card is in; null for pre-session proposals, whose card
  // thread takes the resolution.
  threadRootId: string | null
  cardMessageId: string | null
  rationale: string
}

// Lor finished an ended call's summary; sent to everyone who was in the call.
export type CallSummaryNotification = {
  workspaceId: string
  channelId: string
  channelName: string
  sessionId: string
  // The call chat's root: opening it shows the call's Summary tab.
  threadRootId: string
  title: string
}

export type SubscribedNotification = {
  workspaceId: string
  channelId: string
  channelName: string
  threadRootId: string
  sessionId: string | null
  // The session title; null for a human thread.
  title: string | null
  actorName: string
}

export type ApprovalCreatedEvent = {
  approvalId: string
  channelId: string
  threadRootId: string | null
  messageId: string | null
  planId: string | null
}

export type ApprovalUpdatedEvent = {
  approvalId: string
  channelId: string
  planId: string | null
  status: RealtimeApprovalStatus
  resolvedBy: string | null
  resolvedAt: string | null
}

export type RealtimeLoopStatus = "draft" | "active" | "paused" | "completed"

// Snapshot of a loop, emitted to the channel room on every lifecycle change
// (activate, pause, resume, complete, run settled) — the loop card and the
// loops panel render from it. See reference/loops.md.
export type RealtimeLoop = {
  id: string
  workspaceId: string
  channelId: string
  cardMessageId: string | null
  creatorId: string | null
  name: string
  instructions: string
  schedule: string
  // Null on drafts: schedule renders in the viewer's device timezone until
  // activation pins one.
  timezone: string | null
  endCondition: string | null
  // Hard end date (sweep-enforced); null = no date end.
  endAt: string | null
  status: RealtimeLoopStatus
  pausedReason: "manual" | "failures" | "out_of_credits" | null
  nextRunAt: string | null
  lastRunAt: string | null
  consecutiveFailures: number
  completedNote: string | null
  createdAt: string
  updatedAt: string
}

export type LoopUpdatedEvent = {
  loop: RealtimeLoop
}

export type LorSteerEvent = {
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
