import { createRouter } from "@/lib/helpers/app/create-app"
import attioRouter from "@/routes/v1/integrations/attio/index"
import circlebackRouter from "@/routes/v1/integrations/circleback/index"
import githubRouter from "@/routes/v1/integrations/github/index"
import granolaRouter from "@/routes/v1/integrations/granola/index"
import * as handlers from "@/routes/v1/integrations/handlers"
import linearRouter from "@/routes/v1/integrations/linear/index"
import * as routes from "@/routes/v1/integrations/routes"

// Webhook receivers live in per-provider subfolders (./github, ./linear,
// ./attio, ./granola, ./circleback). The workspace-scoped management endpoints (list/connect/
// disconnect) are here.
const integrationsRouter = createRouter()
  .route("/", githubRouter)
  .route("/", linearRouter)
  .route("/", attioRouter)
  .route("/", granolaRouter)
  .route("/", circlebackRouter)
  .openapi(routes.listIntegrations, handlers.listIntegrations)
  .openapi(routes.startGithubConnect, handlers.startGithubConnect)
  .openapi(routes.completeGithubSetup, handlers.completeGithubSetup)
  .openapi(routes.connectLinear, handlers.connectLinear)
  .openapi(routes.connectAttio, handlers.connectAttio)
  .openapi(routes.connectNotion, handlers.connectNotion)
  .openapi(routes.connectBetterstack, handlers.connectBetterstack)
  .openapi(routes.connectGranola, handlers.connectGranola)
  .openapi(routes.connectCircleback, handlers.connectCircleback)
  .openapi(
    routes.setCirclebackWebhookSecret,
    handlers.setCirclebackWebhookSecret
  )
  .openapi(routes.connectDatadog, handlers.connectDatadog)
  .openapi(routes.connectCloudwatch, handlers.connectCloudwatch)
  .openapi(routes.updateIntegrationTools, handlers.updateIntegrationTools)
  .openapi(routes.createListener, handlers.createListener)
  .openapi(routes.updateListener, handlers.updateListener)
  .openapi(routes.deleteListener, handlers.deleteListener)
  .openapi(routes.listenerSuggestions, handlers.listenerSuggestions)
  .openapi(routes.listenerActivity, handlers.listenerActivity)
  .openapi(routes.disconnectIntegration, handlers.disconnectIntegration)

export default integrationsRouter
