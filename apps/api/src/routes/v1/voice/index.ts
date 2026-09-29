import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/voice/handlers"
import * as routes from "@/routes/v1/voice/routes"

const voiceRouter = createRouter()
  .openapi(routes.joinVoiceChannel, handlers.joinVoiceChannel)
  .openapi(routes.leaveVoiceSession, handlers.leaveVoiceSession)
  .openapi(routes.listVoiceSessions, handlers.listVoiceSessions)
  .openapi(routes.getVoiceSession, handlers.getVoiceSession)
  .openapi(routes.getVoicePresence, handlers.getVoicePresence)

export default voiceRouter
