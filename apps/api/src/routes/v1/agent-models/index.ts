import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/agent-models/handlers"
import * as routes from "@/routes/v1/agent-models/routes"

const agentModelsRouter = createRouter().openapi(
  routes.listAgentModels,
  handlers.listAgentModels
)

export default agentModelsRouter
