import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/agent-profiles/handlers"
import * as routes from "@/routes/v1/agent-profiles/routes"

const agentProfilesRouter = createRouter()
  .openapi(routes.listAgentProfiles, handlers.listAgentProfiles)
  .openapi(routes.createAgentProfile, handlers.createAgentProfile)
  .openapi(routes.updateAgentProfile, handlers.updateAgentProfile)
  .openapi(routes.deleteAgentProfile, handlers.deleteAgentProfile)

export default agentProfilesRouter
