import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/artifacts/handlers"
import * as routes from "@/routes/v1/artifacts/routes"

const artifactsRouter = createRouter()
  .openapi(routes.getArtifact, handlers.getArtifact)
  .openapi(routes.listTaskArtifacts, handlers.listTaskArtifacts)

export default artifactsRouter
