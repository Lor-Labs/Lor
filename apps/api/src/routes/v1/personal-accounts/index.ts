import { createRouter } from "@/lib/helpers/app/create-app"
import * as handlers from "@/routes/v1/personal-accounts/handlers"
import * as routes from "@/routes/v1/personal-accounts/routes"

const personalAccountsRouter = createRouter()
  .openapi(routes.getPersonalAccounts, handlers.getPersonalAccounts)
  .openapi(routes.startGithubAccountConnect, handlers.startGithubAccountConnect)
  .openapi(routes.connectGithubAccount, handlers.connectGithubAccount)
  .openapi(routes.disconnectGithubAccount, handlers.disconnectGithubAccount)
  .openapi(routes.connectClaudeAccount, handlers.connectClaudeAccount)
  .openapi(routes.disconnectClaudeAccount, handlers.disconnectClaudeAccount)

export default personalAccountsRouter
