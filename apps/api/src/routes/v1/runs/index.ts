import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/runs/handlers"
import * as routes from "@/routes/v1/runs/routes"

const runsRouter = createRouter().openapi(
  routes.getRunEvents,
  handlers.getRunEvents
)

export default runsRouter
