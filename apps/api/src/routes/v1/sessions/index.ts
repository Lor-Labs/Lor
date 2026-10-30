import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/sessions/handlers"
import * as routes from "@/routes/v1/sessions/routes"

const sessionsRouter = createRouter()
  .openapi(routes.getAgentSession, handlers.getAgentSession)
  .openapi(routes.listSessionFiles, handlers.listSessionFiles)
  .openapi(routes.getSessionChanges, handlers.getSessionChanges)
  .openapi(routes.getSessionChangeDiff, handlers.getSessionChangeDiff)
  .openapi(routes.stageSessionChanges, handlers.stageSessionChanges)
  .openapi(routes.commitSessionChanges, handlers.commitSessionChanges)
  .openapi(routes.pushSessionChanges, handlers.pushSessionChanges)
  .openapi(routes.pullSessionChanges, handlers.pullSessionChanges)
  .openapi(routes.getRepoTree, handlers.getRepoTree)
  .openapi(routes.getRepoFile, handlers.getRepoFile)
  .openapi(routes.getRepoImage, handlers.getRepoImage)
  .openapi(
    routes.generateSessionCommitMessage,
    handlers.generateSessionCommitMessage
  )
  .openapi(routes.listChannelSessions, handlers.listChannelSessions)
  .openapi(routes.updateAgentSession, handlers.updateAgentSession)
  .openapi(routes.forkAgentSession, handlers.forkAgentSession)
  .openapi(routes.rewindAgentSession, handlers.rewindAgentSession)
  .openapi(routes.getActWaiting, handlers.getActWaiting)
  .openapi(routes.dropActWaiting, handlers.dropActWaiting)
  .openapi(routes.listSessionPorts, handlers.listSessionPorts)
  .openapi(routes.openSessionPort, handlers.openSessionPort)
  .openapi(routes.openSessionTerminal, handlers.openSessionTerminal)
  .openapi(routes.applySessionEnvironment, handlers.applySessionEnvironment)

export default sessionsRouter
