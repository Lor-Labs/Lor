import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/plans/handlers"
import * as routes from "@/routes/v1/plans/routes"

const plansRouter = createRouter()
  .openapi(routes.listChannelPlans, handlers.listChannelPlans)
  .openapi(routes.getPlan, handlers.getPlan)

export default plansRouter
