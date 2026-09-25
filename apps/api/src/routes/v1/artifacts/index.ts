import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/artifacts/handlers"
import * as routes from "@/routes/v1/artifacts/routes"

const artifactsRouter = createRouter()
  .openapi(routes.getArtifact, handlers.getArtifact)
  .openapi(routes.listPlanArtifacts, handlers.listPlanArtifacts)
  .openapi(routes.listChannelFiles, handlers.listChannelFiles)

export default artifactsRouter
