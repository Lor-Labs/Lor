import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/mcp-servers/handlers"
import * as routes from "@/routes/v1/mcp-servers/routes"

// Workspace MCP servers (reference/automation-primitives.md §4). The
// /discover route must register before /{mcpServerId} so "discover" isn't
// captured as an id (uuid param validation would 400 it anyway — order makes
// it unambiguous).
const mcpServersRouter = createRouter()
  .openapi(routes.listMcpServers, handlers.listMcpServers)
  .openapi(routes.discoverMcpServer, handlers.discoverMcpServer)
  .openapi(routes.mcpServerOAuthCallback, handlers.mcpServerOAuthCallback)
  .openapi(routes.createMcpServer, handlers.createMcpServer)
  .openapi(routes.startMcpServerOAuth, handlers.startMcpServerOAuth)
  .openapi(routes.completeMcpServerOAuth, handlers.completeMcpServerOAuth)
  .openapi(routes.disconnectMcpServerOAuth, handlers.disconnectMcpServerOAuth)
  .openapi(routes.rediscoverMcpServer, handlers.rediscoverMcpServer)
  .openapi(routes.updateMcpServer, handlers.updateMcpServer)
  .openapi(routes.deleteMcpServer, handlers.deleteMcpServer)

export default mcpServersRouter
