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
// feedback for in-flight Merlin runs, patched in via socket events.
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
