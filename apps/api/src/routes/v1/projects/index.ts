import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/projects/handlers"
import * as routes from "@/routes/v1/projects/routes"

const projectsRouter = createRouter()
  .openapi(routes.listProjects, handlers.listProjects)
  .openapi(routes.createProject, handlers.createProject)
  .openapi(routes.getProject, handlers.getProject)
  .openapi(routes.updateProject, handlers.updateProject)
  .openapi(routes.archiveProject, handlers.archiveProject)
  .openapi(routes.addProjectMember, handlers.addProjectMember)
  .openapi(routes.removeProjectMember, handlers.removeProjectMember)

export default projectsRouter
