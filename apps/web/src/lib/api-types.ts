import type {
  Client,
  InferRequestType,
  InferResponseType,
} from "@repo/api-client"

// ── Channels ──────────────────────────────────────────

type ChannelsClient = Client["v1"]["workspaces"][":workspaceSlug"]["channels"]

export type ListChannelsResponse = InferResponseType<
  ChannelsClient["$get"],
  200
>
export type Channel = ListChannelsResponse["uncategorized"][number]
export type CategoryWithChannels = ListChannelsResponse["categories"][number]

type ChannelClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["channels"][":channelId"]

export type GetChannelResponse = InferResponseType<ChannelClient["$get"], 200>

// ── Agent Profiles ──────────────────────────────────────────

type AgentProfilesClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["agent-profiles"]

export type AgentProfilesResponse = InferResponseType<
  AgentProfilesClient["$get"],
  200
>
export type AgentProfile = AgentProfilesResponse["profiles"][number]
export type MerlinCapabilityKey = AgentProfile["capabilities"][number]
export type AvailableCapability =
  AgentProfilesResponse["availableCapabilities"][number]
// The set of connector ids (the integration provider enum), shared by the
// capability + integration-status shapes. NonNullable: a capability's
// connector is null for built-in capabilities (web).
export type ConnectorKey = NonNullable<AvailableCapability["connector"]>

// ── Integrations ──────────────────────────────────────────

type IntegrationsClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["integrations"]

export type ConnectDatadogRequest = InferRequestType<
  IntegrationsClient["datadog"]["connect"]["$post"]
>["json"]

export type ConnectCloudwatchRequest = InferRequestType<
  IntegrationsClient["cloudwatch"]["connect"]["$post"]
>["json"]

// ── Messages ──────────────────────────────────────────

type MessagesClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["channels"][":channelId"]["messages"]

export type ListMessagesResponse = InferResponseType<
  MessagesClient["$get"],
  200
>
// Client-only transient fields (never on server payloads): `streaming` while
// Merlin streams its reply. (`remembered` is now a real server field, also
// upserted live via the merlin:memory socket event.)
export type Message = ListMessagesResponse["data"][number] & {
  streaming?: boolean
  // Tool calls in flight while Merlin streams, for a live "searching…" status.
  toolActivity?: { toolCallId: string; label: string }[]
  // Author of the latest mid-run message steered into this in-flight reply.
  steeringBy?: string
  // What happened to this (user) message when it landed mid-run: absorbed by
  // the active run, or queued for the follow-up.
  routedOutcome?: "steered" | "queued"
  // Stop was requested for this in-flight reply (optimistic until the run
  // settles at its next boundary).
  stopRequested?: boolean
}
export type MessageAuthor = Message["author"]
// Entries in Merlin's chronological reasoning/tool trail.
export type MerlinToolCallView = NonNullable<Message["merlinToolCalls"]>[number]
export type MerlinReasoningSegmentView = NonNullable<
  Message["merlinReasoningSegments"]
>[number]

// ── DMs ──────────────────────────────────────────

type DMsClient = Client["v1"]["dms"]

export type ListDMsResponse = InferResponseType<DMsClient["$get"], 200>
export type DM = ListDMsResponse["data"][number]
export type DMember = DM["members"][number]

type DMClient = Client["v1"]["dms"][":dmId"]

export type GetDMResponse = InferResponseType<DMClient["$get"], 200>

type DMMessagesClient = Client["v1"]["dms"][":dmId"]["messages"]

export type ListDMMessagesResponse = InferResponseType<
  DMMessagesClient["$get"],
  200
>

// ── Workspace Invites ──────────────────────────────────────────

type WorkspaceInvitesClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["invites"]

export type ListWorkspaceInvitesResponse = InferResponseType<
  WorkspaceInvitesClient["$get"],
  200
>
export type WorkspaceInvite = ListWorkspaceInvitesResponse["invites"][number]

type InvitePreviewClient = Client["v1"]["invites"][":code"]

export type InvitePreviewResponse = InferResponseType<
  InvitePreviewClient["$get"],
  200
>

// ── Approvals ──────────────────────────────────────────

type ChannelApprovalsClient =
  Client["v1"]["channels"][":channelId"]["approvals"]

export type ChannelApprovalList = InferResponseType<
  ChannelApprovalsClient["$get"],
  200
>
export type ChannelApproval = ChannelApprovalList["approvals"][number]

type ApprovalPoliciesClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["approval-policies"]

export type ApprovalPoliciesResponse = InferResponseType<
  ApprovalPoliciesClient["$get"],
  200
>
export type ApprovalPolicy = ApprovalPoliciesResponse["policies"][number]
export type ApprovalTarget = ApprovalPoliciesResponse["targets"][number]

// ── Users ──────────────────────────────────────────

type UserProfileClient = Client["v1"]["users"][":userId"]

export type GetUserProfileResponse = InferResponseType<
  UserProfileClient["$get"],
  200
>
export type UserProfile = GetUserProfileResponse["user"]

// ── Workspace Members ──────────────────────────────────────────

type WorkspaceMembersClient =
  Client["v1"]["workspaces"][":workspaceSlug"]["members"]

export type ListWorkspaceMembersResponse = InferResponseType<
  WorkspaceMembersClient["$get"],
  200
>
export type WorkspaceMemberPresence =
  ListWorkspaceMembersResponse["members"][number]
