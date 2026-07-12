import type { Client, InferResponseType } from "@repo/api-client"

type ChannelsClient = Client["v1"]["workspaces"][":workspaceSlug"]["channels"]
type ChannelClient = ChannelsClient[":channelId"]
type MessagesClient = ChannelClient["messages"]

export type ChannelList = InferResponseType<ChannelsClient["$get"], 200>
export type Channel = ChannelList["uncategorized"][number]
export type ChannelCategory = ChannelList["categories"][number]
export type ChannelDetail = InferResponseType<ChannelClient["$get"], 200>
export type MessageList = InferResponseType<MessagesClient["$get"], 200>
export type Message = MessageList["data"][number]
