import { auth } from "@repo/auth"
import { env } from "@repo/env/server"
import { cors } from "hono/cors"
import createApp from "@/lib/helpers/app/create-app"
import configureOpenAPI from "@/lib/helpers/openapi/configure-openapi"
import { globalRateLimit } from "@/middleware/rate-limit"
import index from "@/routes/index.route"
import agentProfilesRouter from "@/routes/v1/agent-profiles/index"
import approvalPoliciesRouter from "@/routes/v1/approval-policies/index"
import approvalsRouter from "@/routes/v1/approvals/index"
import artifactsRouter from "@/routes/v1/artifacts/index"
import billingRouter from "@/routes/v1/billing/index"
import channelMutesRouter from "@/routes/v1/channel-mutes/index"
import channelsRouter from "@/routes/v1/channels/index"
import customToolsRouter from "@/routes/v1/custom-tools/index"
import dmsRouter from "@/routes/v1/dms/index"
import faviconRouter from "@/routes/v1/favicon/index"
import hintsRouter from "@/routes/v1/hints/index"
import instructionsRouter from "@/routes/v1/instructions/index"
import integrationsRouter from "@/routes/v1/integrations/index"
import invitesRouter from "@/routes/v1/invites/index"
import loopsRouter from "@/routes/v1/loops/index"
import mcpServersRouter from "@/routes/v1/mcp-servers/index"
import notificationSettingsRouter from "@/routes/v1/notification-settings/index"
import onboardingRouter from "@/routes/v1/onboarding/index"
import plansRouter from "@/routes/v1/plans/index"
import projectsRouter from "@/routes/v1/projects/index"
import proposalsRouter from "@/routes/v1/proposals/index"
import pushTokensRouter from "@/routes/v1/push-tokens/index"
import runsRouter from "@/routes/v1/runs/index"
import uploadsRouter from "@/routes/v1/uploads/index"
import usersRouter from "@/routes/v1/users/index"
import voiceRouter from "@/routes/v1/voice/index"
import webhooksRouter from "@/routes/v1/webhooks/index"
import workspacesRouter from "@/routes/v1/workspaces/index"
import waitlistRouter from "@/routes/waitlist/index"

const app = createApp()

// Same allowlist model as the realtime gateway: env-driven web origins plus
// the fixed native-app origins. Reflecting arbitrary origins while
// credentials are on would let any site make cookie-authenticated calls.
const corsOrigins = new Set([
  ...env.REALTIME_CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  "tauri://localhost",
  "http://tauri.localhost",
  "lor://",
  "lor-dev://",
])

app.use(
  "*",
  cors({
    origin: (origin) => (corsOrigins.has(origin) ? origin : null),
    credentials: true,
  })
)

app.use("*", globalRateLimit)

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw)
})

configureOpenAPI(app)

// Health check at root
app.route("/", index)

// Route mounting — chained for Hono RPC type inference
const routes = app
  .route("/", waitlistRouter)
  .route("/v1", channelsRouter)
  .route("/v1", projectsRouter)
  .route("/v1", workspacesRouter)
  .route("/v1", onboardingRouter)
  .route("/v1", invitesRouter)
  .route("/v1", notificationSettingsRouter)
  .route("/v1", pushTokensRouter)
  .route("/v1", channelMutesRouter)
  .route("/v1", hintsRouter)
  .route("/v1", dmsRouter)
  .route("/v1", uploadsRouter)
  .route("/v1", usersRouter)
  .route("/v1", integrationsRouter)
  .route("/v1", agentProfilesRouter)
  .route("/v1", customToolsRouter)
  .route("/v1", mcpServersRouter)
  .route("/v1", webhooksRouter)
  .route("/v1", billingRouter)
  .route("/v1", runsRouter)
  .route("/v1", artifactsRouter)
  .route("/v1", plansRouter)
  .route("/v1", approvalsRouter)
  .route("/v1", approvalPoliciesRouter)
  .route("/v1", proposalsRouter)
  .route("/v1", loopsRouter)
  .route("/v1", instructionsRouter)
  .route("/v1", voiceRouter)
  .route("/v1", faviconRouter)

export type AppType = typeof routes

// // Internal routes (not versioned)
// const internalRoutes = [waitlistRouter] as const
// for (const route of internalRoutes) {
//   app.route("/", route)
// }
//
// // Versioned public API routes
// const v1Routes = [channelsRouter] as const
// for (const route of v1Routes) {
//   app.route("/v1", route)
// }
//
// const allRoutes = [...internalRoutes, ...v1Routes] as const
//
// export type AppType = (typeof allRoutes)[number]

export default app
