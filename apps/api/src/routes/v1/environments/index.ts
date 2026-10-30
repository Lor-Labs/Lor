import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/environments/handlers"
import * as routes from "@/routes/v1/environments/routes"

const environmentsRouter = createRouter()
  .openapi(routes.getEnvironment, handlers.getEnvironment)
  .openapi(routes.saveEnvironment, handlers.saveEnvironment)
  .openapi(routes.revealEnvironment, handlers.revealEnvironment)

export default environmentsRouter
