import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  internalServerErrorSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  connectGithubAccountBodySchema,
  connectGithubAccountResponseSchema,
  disconnectGithubAccountResponseSchema,
  githubConnectUrlResponseSchema,
  personalAccountsResponseSchema,
} from "@/routes/v1/personal-accounts/schema"

export const getPersonalAccounts = createRoute({
  path: "/personal-accounts",
  method: "get",
  summary: "List your accounts",
  description:
    "The current user's own accounts (GitHub), used only for turns they start and actions they take. Never shared with the workspace.",
  tags: ["Personal Accounts"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: personalAccountsResponseSchema,
      description: "Your accounts",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetPersonalAccountsRoute = typeof getPersonalAccounts

export const startGithubAccountConnect = createRoute({
  path: "/personal-accounts/github/connect-url",
  method: "post",
  summary: "Start connecting your GitHub account",
  description:
    "Returns the GitHub App's user authorization URL with a signed state bound to the current user.",
  tags: ["Personal Accounts"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: githubConnectUrlResponseSchema,
      description: "Authorization URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type StartGithubAccountConnectRoute = typeof startGithubAccountConnect

export const connectGithubAccount = createRoute({
  path: "/personal-accounts/github/connect",
  method: "post",
  summary: "Connect your GitHub account",
  description:
    "Called by the OAuth callback page: exchanges the code and stores the person's GitHub tokens, encrypted.",
  tags: ["Personal Accounts"],
  middleware: [sessionAuthMiddleware] as const,
  hide: true,
  request: {
    body: jsonContent({
      schema: connectGithubAccountBodySchema,
      description: "The authorization code and the returned state",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectGithubAccountResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type ConnectGithubAccountRoute = typeof connectGithubAccount

export const disconnectGithubAccount = createRoute({
  path: "/personal-accounts/github",
  method: "delete",
  summary: "Disconnect your GitHub account",
  description:
    "Deletes the stored tokens and revokes them at GitHub. The GitHub App stays installed on the workspace's repositories.",
  tags: ["Personal Accounts"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: disconnectGithubAccountResponseSchema,
      description: "Disconnected",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type DisconnectGithubAccountRoute = typeof disconnectGithubAccount
