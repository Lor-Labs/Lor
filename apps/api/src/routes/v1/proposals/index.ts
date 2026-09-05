import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/proposals/handlers"
import * as routes from "@/routes/v1/proposals/routes"

const proposalsRouter = createRouter()
  .openapi(routes.getProposal, handlers.getProposal)
  .openapi(routes.listChannelProposals, handlers.listChannelProposals)
  .openapi(routes.approveProposal, handlers.approveProposal)
  .openapi(routes.rejectProposal, handlers.rejectProposal)

export default proposalsRouter
