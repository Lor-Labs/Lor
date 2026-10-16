import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/approval-policies/handlers"
import * as routes from "@/routes/v1/approval-policies/routes"

const approvalPoliciesRouter = createRouter()
  .openapi(routes.listApprovalPolicies, handlers.listApprovalPolicies)
  .openapi(routes.upsertApprovalPolicy, handlers.upsertApprovalPolicy)
  .openapi(routes.bulkApprovalPolicies, handlers.bulkApprovalPolicies)
  .openapi(routes.deleteApprovalPolicy, handlers.deleteApprovalPolicy)

export default approvalPoliciesRouter
