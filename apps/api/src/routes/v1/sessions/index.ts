import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/sessions/handlers"
import * as routes from "@/routes/v1/sessions/routes"

const sessionsRouter = createRouter()
  .openapi(routes.getAgentSession, handlers.getAgentSession)
  .openapi(routes.listSessionFiles, handlers.listSessionFiles)
  .openapi(routes.getSessionChanges, handlers.getSessionChanges)
  .openapi(routes.getSessionChangeDiff, handlers.getSessionChangeDiff)
  .openapi(routes.stageSessionChanges, handlers.stageSessionChanges)
  .openapi(
    routes.generateSessionCommitMessage,
    handlers.generateSessionCommitMessage
  )
  .openapi(routes.listChannelSessions, handlers.listChannelSessions)
  .openapi(routes.updateAgentSession, handlers.updateAgentSession)

export default sessionsRouter
