import { agentModelCatalog } from "@repo/lor/model-catalog"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { ListAgentModelsRoute } from "@/routes/v1/agent-models/routes"

export const listAgentModels: AppRouteHandler<ListAgentModelsRoute> = async (
  c
) => {
  const { harness } = c.req.valid("query")
  return c.json(
    await agentModelCatalog(harness, c.var.user.id),
    HttpStatusCodes.OK
  )
}
