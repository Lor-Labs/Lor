import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/approvals/handlers"
import * as routes from "@/routes/v1/approvals/routes"

const approvalsRouter = createRouter()
  .openapi(routes.approveApproval, handlers.approveApproval)
  .openapi(routes.rejectApproval, handlers.rejectApproval)

export default approvalsRouter
