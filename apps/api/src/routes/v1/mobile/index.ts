import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/mobile/handlers"
import * as routes from "@/routes/v1/mobile/routes"

const mobileRouter = createRouter().openapi(
  routes.getMobileVersion,
  handlers.getMobileVersion
)

export default mobileRouter
