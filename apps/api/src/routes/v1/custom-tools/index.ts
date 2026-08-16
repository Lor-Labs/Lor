import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/custom-tools/handlers"
import * as routes from "@/routes/v1/custom-tools/routes"

// Workspace custom-tool registry (reference/automation-primitives.md §4).
// These endpoints are also Merlin's future self-configuration surface — the
// settings UI and the agent call the same CRUD.
const customToolsRouter = createRouter()
  .openapi(routes.listCustomTools, handlers.listCustomTools)
  .openapi(routes.createCustomTool, handlers.createCustomTool)
  .openapi(routes.updateCustomTool, handlers.updateCustomTool)
  .openapi(routes.archiveCustomTool, handlers.archiveCustomTool)

export default customToolsRouter
