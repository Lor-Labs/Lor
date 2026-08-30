import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/loops/handlers"
import * as routes from "@/routes/v1/loops/routes"

const loopsRouter = createRouter()
  .openapi(routes.listChannelLoops, handlers.listChannelLoops)
  .openapi(routes.activateLoop, handlers.activateLoop)
  .openapi(routes.discardDraftLoop, handlers.discardDraftLoop)
  .openapi(routes.updateLoop, handlers.updateLoop)
  .openapi(routes.pauseLoop, handlers.pauseLoop)
  .openapi(routes.resumeLoop, handlers.resumeLoop)
  .openapi(routes.runLoopNow, handlers.runLoopNow)
  .openapi(routes.completeLoop, handlers.completeLoop)
  .openapi(routes.deleteLoop, handlers.deleteLoop)
  .openapi(routes.listLoopRuns, handlers.listLoopRuns)

export default loopsRouter
