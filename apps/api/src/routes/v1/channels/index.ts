import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/channels/handlers"
import * as routes from "@/routes/v1/channels/routes"

const channelsRouter = createRouter()
  .openapi(routes.listChannels, handlers.listChannels)
  .openapi(routes.createChannel, handlers.createChannel)
  .openapi(routes.reorderChannels, handlers.reorderChannels)
  .openapi(routes.getChannel, handlers.getChannel)
  .openapi(routes.getChannelReadPosition, handlers.getChannelReadPosition)
  .openapi(routes.updateChannel, handlers.updateChannel)
  .openapi(routes.deleteChannel, handlers.deleteChannel)
  .openapi(routes.listChannelMessages, handlers.listChannelMessages)
  .openapi(routes.toggleMessagePin, handlers.toggleMessagePin)
  .openapi(routes.listPinnedMessages, handlers.listPinnedMessages)
  .openapi(routes.listThreadReplies, handlers.listThreadReplies)
  .openapi(routes.getChannelAudience, handlers.getChannelAudience)
  .openapi(routes.listThreadActivity, handlers.listThreadActivity)
  .openapi(routes.markThreadRead, handlers.markThreadRead)
  .openapi(routes.getMessageLocation, handlers.getMessageLocation)
  .openapi(routes.listChannelConnectors, handlers.listChannelConnectors)
  .openapi(routes.searchChannelConnector, handlers.searchChannelConnector)
  .openapi(routes.listConnectorScopes, handlers.listConnectorScopes)
  .openapi(routes.searchConnectorFiles, handlers.searchConnectorFiles)
  .openapi(routes.listCodeBranches, handlers.listCodeBranches)

export default channelsRouter
