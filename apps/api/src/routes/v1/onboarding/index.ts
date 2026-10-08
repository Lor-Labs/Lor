import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/onboarding/handlers"
import * as routes from "@/routes/v1/onboarding/routes"

const onboardingRouter = createRouter().openapi(
  routes.getCompanySite,
  handlers.getCompanySite
)

export default onboardingRouter
