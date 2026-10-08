import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/workspaces/handlers"
import * as routes from "@/routes/v1/workspaces/routes"

const workspacesRouter = createRouter()
  .openapi(routes.createWorkspace, handlers.createWorkspace)
  .openapi(routes.completeWorkspaceSetup, handlers.completeWorkspaceSetup)
  .openapi(routes.listWorkspaceMembers, handlers.listWorkspaceMembers)
  .openapi(routes.searchMessages, handlers.searchMessages)
  .openapi(routes.updateWorkspace, handlers.updateWorkspace)
  .openapi(routes.updateWorkspaceMemberRole, handlers.updateWorkspaceMemberRole)
  .openapi(routes.kickWorkspaceMember, handlers.kickWorkspaceMember)
  .openapi(routes.deleteWorkspaceRole, handlers.deleteWorkspaceRole)

export default workspacesRouter
