import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/hints/handlers"
import * as routes from "@/routes/v1/hints/routes"

const hintsRouter = createRouter()
  .openapi(routes.listHints, handlers.listHints)
  .openapi(routes.dismissHint, handlers.dismissHint)

export default hintsRouter
