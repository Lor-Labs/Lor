import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/runs/handlers"
import * as routes from "@/routes/v1/runs/routes"

const runsRouter = createRouter()
  .openapi(routes.getRunEvents, handlers.getRunEvents)
  .openapi(routes.stopRun, handlers.stopRun)
  .openapi(routes.steerQueuedMessage, handlers.steerQueuedMessage)
  .openapi(routes.removeQueuedMessage, handlers.removeQueuedMessage)

export default runsRouter
