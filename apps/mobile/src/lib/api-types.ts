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
export type Message = MessageList["data"][number]
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
export type NotificationSettings = InferResponseType<
  Client["v1"]["notification-settings"]["$get"],
  200
>
export type UserProfile = InferResponseType<
  Client["v1"]["users"][":userId"]["$get"],
  200
>["user"]
