import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/instructions/handlers"
import * as routes from "@/routes/v1/instructions/routes"

const instructionsRouter = createRouter()
  .openapi(routes.getInstructions, handlers.getInstructions)
  .openapi(routes.updateInstructions, handlers.updateInstructions)
  .openapi(
    routes.approveInstructionsProposal,
    handlers.approveInstructionsProposal
  )
  .openapi(
    routes.rejectInstructionsProposal,
    handlers.rejectInstructionsProposal
  )

export default instructionsRouter
