import type { Client, InferResponseType } from "@repo/api-client"

type WorkspaceClient = Client["v1"]["workspaces"][":workspaceSlug"]
type ChannelsClient = Client["v1"]["workspaces"][":workspaceSlug"]["channels"]
type ChannelClient = ChannelsClient[":channelId"]
type MessagesClient = ChannelClient["messages"]
type MessageClient = MessagesClient[":messageId"]

export type ChannelList = InferResponseType<ChannelsClient["$get"], 200>
export type Channel = ChannelList["uncategorized"][number]
export type ChannelCategory = ChannelList["categories"][number]
export type ChannelDetail = InferResponseType<ChannelClient["$get"], 200>
export type MessageList = InferResponseType<MessagesClient["$get"], 200>
// Client-only transient fields (never on server payloads): steering/stop
// feedback for in-flight Lor runs, patched in via socket events.
export type Message = MessageList["data"][number] & {
  // Author of the latest mid-run message steered into this in-flight reply.
  steeringBy?: string
  // What happened to this (user) message when it landed mid-run.
  routedOutcome?: "steered" | "queued"
}
export type ThreadMessageList = InferResponseType<
  MessageClient["thread"]["$get"],
  200
>
export type PinnedMessageList = InferResponseType<
  ChannelClient["pins"]["$get"],
  200
>
export type WorkspaceMemberList = InferResponseType<
  WorkspaceClient["members"]["$get"],
  200
>
export type WorkspaceMember = WorkspaceMemberList["members"][number]
export type ChannelSearchResults = InferResponseType<
  WorkspaceClient["search"]["$get"],
  200
>
export type ChannelSearchResult = ChannelSearchResults["data"][number]
export type WorkspaceInstructions = InferResponseType<
  WorkspaceClient["instructions"]["$get"],
  200
>
export type AgentProfilesResponse = InferResponseType<
  WorkspaceClient["agent-profiles"]["$get"],
  200
>
export type AgentProfile = AgentProfilesResponse["profiles"][number]
export type LorCapabilityKey = AgentProfile["capabilities"][number]
export type AvailableCapability =
  AgentProfilesResponse["availableCapabilities"][number]
export type NotificationSettings = InferResponseType<
  Client["v1"]["notification-settings"]["$get"],
  200
>
export type UserProfile = InferResponseType<
  Client["v1"]["users"][":userId"]["$get"],
  200
>["user"]
export type DMList = InferResponseType<Client["v1"]["dms"]["$get"], 200>
export type DM = DMList["data"][number]
export type DMMember = DM["members"][number]
export type DMSearchResults = InferResponseType<
  Client["v1"]["dms"]["search"]["$get"],
  200
>
export type DMSearchResult = DMSearchResults["data"][number]
export type ChannelPlanList = InferResponseType<
  Client["v1"]["channels"][":channelId"]["plans"]["$get"],
  200
>
export type ChannelPlan = ChannelPlanList["plans"][number]
export type PlanStep = ChannelPlan["steps"][number]
export type PlanDetail = InferResponseType<
  Client["v1"]["plans"][":planId"]["$get"],
  200
>
export type PlanApproval = NonNullable<PlanDetail["pendingApproval"]>
export type ChannelApprovalList = InferResponseType<
  Client["v1"]["channels"][":channelId"]["approvals"]["$get"],
  200
>
export type ChannelApproval = ChannelApprovalList["approvals"][number]
export type ChannelProposalList = InferResponseType<
  Client["v1"]["channels"][":channelId"]["proposals"]["$get"],
  200
>
export type ChannelProposal = ChannelProposalList["proposals"][number]
export type ProposalOperation = ChannelProposal["operations"][number]
export type PlanArtifact = InferResponseType<
  Client["v1"]["plans"][":planId"]["artifacts"]["$get"],
  200
>["artifacts"][number]

export type AgentSessionDetail = InferResponseType<
  Client["v1"]["sessions"][":sessionId"]["$get"],
  200
>

export type ChannelLoopList = InferResponseType<
  Client["v1"]["channels"][":channelId"]["loops"]["$get"],
  200
>
export type ChannelLoop = ChannelLoopList["loops"][number]
