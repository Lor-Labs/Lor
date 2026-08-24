import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/loops/handlers"
import * as routes from "@/routes/v1/loops/routes"

const loopsRouter = createRouter()
  .openapi(routes.listChannelLoops, handlers.listChannelLoops)
  .openapi(routes.activateLoop, handlers.activateLoop)

export default loopsRouter
