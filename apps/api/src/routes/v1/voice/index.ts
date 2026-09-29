import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/voice/handlers"
import * as routes from "@/routes/v1/voice/routes"

const voiceRouter = createRouter().openapi(
  routes.joinVoiceChannel,
  handlers.joinVoiceChannel
)

export default voiceRouter
