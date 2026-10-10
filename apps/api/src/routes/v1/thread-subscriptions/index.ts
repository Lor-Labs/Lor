import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/thread-subscriptions/handlers"
import * as routes from "@/routes/v1/thread-subscriptions/routes"

const threadSubscriptionsRouter = createRouter()
  .openapi(routes.listThreadSubscribers, handlers.listThreadSubscribers)
  .openapi(routes.addThreadSubscriber, handlers.addThreadSubscriber)
  .openapi(routes.subscribeEveryone, handlers.subscribeEveryone)
  .openapi(routes.removeThreadSubscriber, handlers.removeThreadSubscriber)

export default threadSubscriptionsRouter
