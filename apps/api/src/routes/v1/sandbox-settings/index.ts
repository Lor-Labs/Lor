import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/sandbox-settings/handlers"
import * as routes from "@/routes/v1/sandbox-settings/routes"

const sandboxSettingsRouter = createRouter()
  .openapi(routes.getSandboxSettings, handlers.getSandboxSettings)
  .openapi(routes.updateSandboxSettings, handlers.updateSandboxSettings)

export default sandboxSettingsRouter
