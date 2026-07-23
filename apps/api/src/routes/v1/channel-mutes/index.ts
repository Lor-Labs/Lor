import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/channel-mutes/handlers"
import * as routes from "@/routes/v1/channel-mutes/routes"

const channelMutesRouter = createRouter()
  .openapi(routes.listChannelMutes, handlers.listChannelMutes)
  .openapi(routes.muteChannel, handlers.muteChannel)
  .openapi(routes.unmuteChannel, handlers.unmuteChannel)

export default channelMutesRouter
