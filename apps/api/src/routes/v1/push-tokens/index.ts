import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/push-tokens/handlers"
import * as routes from "@/routes/v1/push-tokens/routes"

const pushTokensRouter = createRouter()
  .openapi(routes.registerPushToken, handlers.registerPushToken)
  .openapi(routes.removePushToken, handlers.removePushToken)

export default pushTokensRouter
