import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/discord/handlers"
import * as routes from "@/routes/v1/discord/routes"

const discordRouter = createRouter()
  .openapi(routes.getChannelDiscord, handlers.getChannelDiscord)
  .openapi(
    routes.createChannelDiscordLinkCode,
    handlers.createChannelDiscordLinkCode
  )
  .openapi(routes.unlinkChannelDiscord, handlers.unlinkChannelDiscord)
  .openapi(routes.getDiscordAccount, handlers.getDiscordAccount)
  .openapi(routes.connectDiscordAccount, handlers.connectDiscordAccount)
  .openapi(routes.disconnectDiscordAccount, handlers.disconnectDiscordAccount)

export default discordRouter
