import { createRouter } from "@/lib/helpers/app/create-app"
import attioRouter from "@/routes/v1/integrations/attio/index"
import githubRouter from "@/routes/v1/integrations/github/index"
import * as handlers from "@/routes/v1/integrations/handlers"
import linearRouter from "@/routes/v1/integrations/linear/index"
import * as routes from "@/routes/v1/integrations/routes"

// Webhook receivers live in per-provider subfolders (./github, ./linear,
// ./attio). The workspace-scoped management endpoints (list/connect/
// disconnect) are here.
const integrationsRouter = createRouter()
  .route("/", githubRouter)
  .route("/", linearRouter)
  .route("/", attioRouter)
  .openapi(routes.listIntegrations, handlers.listIntegrations)
  .openapi(routes.connectGithub, handlers.connectGithub)
  .openapi(routes.connectLinear, handlers.connectLinear)
  .openapi(routes.connectAttio, handlers.connectAttio)
  .openapi(routes.connectNotion, handlers.connectNotion)
  .openapi(routes.connectDatadog, handlers.connectDatadog)
  .openapi(routes.connectCloudwatch, handlers.connectCloudwatch)
  .openapi(routes.updateIntegration, handlers.updateIntegration)
  .openapi(routes.disconnectIntegration, handlers.disconnectIntegration)

export default integrationsRouter
