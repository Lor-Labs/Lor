import { createRouter } from "@/lib/helpers/app/create-app"
import githubRouter from "@/routes/v1/integrations/github/index"
import * as handlers from "@/routes/v1/integrations/handlers"
import linearRouter from "@/routes/v1/integrations/linear/index"
import * as routes from "@/routes/v1/integrations/routes"

// Webhook receivers live in per-provider subfolders (./github, ./linear). The
// workspace-scoped management endpoints (list/connect/disconnect) are here.
const integrationsRouter = createRouter()
  .route("/", githubRouter)
  .route("/", linearRouter)
  .openapi(routes.listIntegrations, handlers.listIntegrations)
  .openapi(routes.connectGithub, handlers.connectGithub)
  .openapi(routes.connectLinear, handlers.connectLinear)
  .openapi(routes.connectDatadog, handlers.connectDatadog)
  .openapi(routes.updateIntegration, handlers.updateIntegration)
  .openapi(routes.disconnectIntegration, handlers.disconnectIntegration)

export default integrationsRouter
