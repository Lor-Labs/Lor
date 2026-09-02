import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/tasks/handlers"
import * as routes from "@/routes/v1/tasks/routes"

const tasksRouter = createRouter()
  .openapi(routes.listChannelTasks, handlers.listChannelTasks)
  .openapi(routes.getTask, handlers.getTask)

export default tasksRouter
