import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/agents/handlers"
import * as routes from "@/routes/v1/agents/routes"

const agentsRouter = createRouter()
  .openapi(routes.listAgents, handlers.listAgents)
  .openapi(routes.createAgent, handlers.createAgent)
  .openapi(routes.updateAgent, handlers.updateAgent)
  .openapi(routes.deleteAgent, handlers.deleteAgent)
  .openapi(routes.listAgentFacts, handlers.listAgentFacts)
  .openapi(routes.updateAgentFact, handlers.updateAgentFact)
  .openapi(routes.deleteAgentFact, handlers.deleteAgentFact)

export default agentsRouter
