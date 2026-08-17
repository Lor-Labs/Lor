import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/tool-servers/handlers"
import * as routes from "@/routes/v1/tool-servers/routes"

// Workspace MCP tool servers (reference/automation-primitives.md §4). The
// /discover route must register before /{serverId} so "discover" isn't
// captured as an id (uuid param validation would 400 it anyway — order makes
// it unambiguous).
const toolServersRouter = createRouter()
  .openapi(routes.listToolServers, handlers.listToolServers)
  .openapi(routes.discoverToolServer, handlers.discoverToolServer)
  .openapi(routes.createToolServer, handlers.createToolServer)
  .openapi(routes.rediscoverToolServer, handlers.rediscoverToolServer)
  .openapi(routes.updateToolServer, handlers.updateToolServer)
  .openapi(routes.deleteToolServer, handlers.deleteToolServer)

export default toolServersRouter
