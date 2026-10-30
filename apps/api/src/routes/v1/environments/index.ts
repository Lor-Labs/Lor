import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/environments/handlers"
import * as routes from "@/routes/v1/environments/routes"

const environmentsRouter = createRouter()
  .openapi(routes.listEnvironments, handlers.listEnvironments)
  .openapi(routes.createEnvironment, handlers.createEnvironment)
  .openapi(routes.updateEnvironment, handlers.updateEnvironment)
  .openapi(routes.revealEnvironment, handlers.revealEnvironment)
  .openapi(routes.deleteEnvironment, handlers.deleteEnvironment)

export default environmentsRouter
