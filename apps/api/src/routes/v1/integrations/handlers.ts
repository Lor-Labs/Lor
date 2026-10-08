import {
  CONNECTOR_EVENTS,
  CONNECTOR_LIST,
  type ConnectorDescriptor,
  connectorCapabilities,
  isConnectorEvent,
} from "@repo/connectors"
import { db, schema } from "@repo/db"
import {
  ACT_DEFAULTS,
  channel,
  connectorTrigger,
  githubRepoConfig,
  integrationConnection,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  branchExists,
  deleteAttioWebhook,
  connectAttio as exchangeAttioCode,
  connectLinear as exchangeLinearCode,
  connectNotion as exchangeNotionCode,
  getAttioAccessToken,
  getInstallationOverview,
  getSourceProvider,
  listInstallationRepos,
  connectCloudwatch as verifyCloudwatchKeys,
  connectDatadog as verifyDatadogKeys,
} from "@repo/lor/providers"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import {
  clearGithubConnectIntent,
  readGithubConnectIntent,
  recordGithubConnectIntent,
} from "@/lib/github-connect-intent"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { lastActByTrigger } from "@/lib/last-act"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
  resolveWorkspaceAuthority,
} from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { ATTIO_EVENT_SUBSCRIPTIONS } from "@/routes/v1/integrations/attio/index"
import type {
  CompleteGithubSetupRoute,
  ConnectAttioRoute,
  ConnectCloudwatchRoute,
  ConnectDatadogRoute,
  ConnectLinearRoute,
  ConnectNotionRoute,
  DisconnectIntegrationRoute,
  ListIntegrationsRoute,
  StartGithubConnectRoute,
  UpdateGithubRepoConfigRoute,
  UpdateIntegrationRoute,
} from "@/routes/v1/integrations/routes"

// Used for both the authorize URL and the token exchange — they must match.
const linearRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/linear/callback`

const attioRedirectUri = () => `${env.APP_BASE_URL}/integrations/attio/callback`

// Where Attio delivers events — must be publicly reachable (tunnel in dev).
const attioWebhookTargetUrl = () =>
  `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")}/v1/integrations/attio/webhook`

const notionRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/notion/callback`

// actor=app: actions are attributed to the Lor app (and its app user costs
// no Linear seat). Scope is comma-separated per Linear — keep the comma literal.
function linearConnectUrl(state: string): string | null {
  if (!env.LINEAR_CLIENT_ID) return null
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LINEAR_CLIENT_ID,
    redirect_uri: linearRedirectUri(),
    state,
    actor: "app",
    prompt: "consent",
  })
  return `https://linear.app/oauth/authorize?${params.toString()}&scope=read,write`
}

function attioConnectUrl(state: string): string | null {
  if (!env.ATTIO_CLIENT_ID) return null
  // Attio OAuth scopes are configured on the app in the Developer Console,
  // not requested on this URL. It must include all eleven scopes in
  // ATTIO_REQUIRED_READ_SCOPES plus webhook:read-write (the only permitted
  // write scope — event webhook management), and nothing else; connectAttio
  // enforces that exact policy after exchange
  // (packages/lor/src/providers/attio.ts).
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ATTIO_CLIENT_ID,
    redirect_uri: attioRedirectUri(),
    state,
  })
  return `https://app.attio.com/authorize?${params.toString()}`
}

function notionConnectUrl(state: string): string | null {
  if (!env.NOTION_CLIENT_ID) return null
  // Notion capabilities are configured in the Developer portal, not requested
  // on this URL. Configure only Read content, Read comments, and User
  // information without email addresses; the connector exposes no write tools.
  const params = new URLSearchParams({
    owner: "user",
    client_id: env.NOTION_CLIENT_ID,
    redirect_uri: notionRedirectUri(),
    response_type: "code",
    state,
  })
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`
}

function githubInstallUrl(state: string): string | null {
  if (!env.GITHUB_APP_SLUG) return null
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`
}

// The connect entry point per auth type. The `state` round-trips back to the
// callback/setup redirect as a short-lived signed state, CSRF-bound to the
// user + workspace. Clients start GitHub through startGithubConnect instead,
// which also records the connect intent. null → the connector shows as
// Unavailable.
function connectUrlFor(
  descriptor: ConnectorDescriptor,
  ctx: { slug: string; userId: string }
): string | null {
  switch (descriptor.authType) {
    case "github-app":
      return githubInstallUrl(signOAuthState(ctx.slug, ctx.userId))
    case "oauth":
      switch (descriptor.id) {
        case "linear":
          return linearConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        case "attio":
          return attioConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        case "notion":
          return notionConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        default:
          return null
      }
    case "api-key":
      // Keyed connectors are entered in-app, not via a redirect.
      return null
    case "token":
      // BYO webhooks are created from channel settings, never connected here.
      return null
  }
}

export const listIntegrations: AppRouteHandler<ListIntegrationsRoute> = async (
  c
) => {
  const canManage = hasWorkspaceAuthority(c.var.authority, {
    connector: ["manage"],
  })
  const workspace = c.var.workspace

  const connections = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
      accountLogin: integrationConnection.accountLogin,
      externalId: integrationConnection.externalId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.status, "active")
      )
    )
  const byProvider = new Map(connections.map((r) => [r.provider, r]))

  const triggers =
    connections.length > 0
      ? await db
          .select({
            id: connectorTrigger.id,
            connectionId: connectorTrigger.connectionId,
            event: connectorTrigger.event,
            channelId: connectorTrigger.channelId,
            post: connectorTrigger.post,
            remember: connectorTrigger.remember,
            rememberHint: connectorTrigger.rememberHint,
            actInstructions: connectorTrigger.actInstructions,
            actWindowSeconds: connectorTrigger.actWindowSeconds,
            hourlyRunCap: connectorTrigger.hourlyRunCap,
            dailyRunCap: connectorTrigger.dailyRunCap,
          })
          .from(connectorTrigger)
          .where(
            inArray(
              connectorTrigger.connectionId,
              connections.map((r) => r.id)
            )
          )
      : []
  const triggerByEvent = new Map(
    triggers.map((t) => [`${t.connectionId}:${t.event}`, t])
  )

  // Newest agent_run per trigger in one query — one per event would fan out
  // across every connector.
  const lastActs = await lastActByTrigger(triggers.map((t) => t.id))

  if (!env.GITHUB_APP_SLUG) {
    logger.warn(
      { workspaceSlug: workspace.slug },
      "GITHUB_APP_SLUG not set; GitHub integration shows as Unavailable"
    )
  }

  // GitHub surfaces its accessible repos (read-only) + manage URL; other
  // connectors have none. Best-effort — a hiccup leaves them null.
  const MAX_REPOS = 100

  const providers = await Promise.all(
    CONNECTOR_LIST.map(async (descriptor) => {
      const conn = byProvider.get(descriptor.id) ?? null
      let repos:
        | {
            fullName: string
            private: boolean
            defaultBranch: string
            baseBranch: string | null
          }[]
        | null = null
      let repoCount: number | null = null
      let manageUrl: string | null = null
      if (descriptor.id === "github" && conn) {
        const [overview, configRows] = await Promise.all([
          getInstallationOverview(conn.externalId).catch(() => null),
          db
            .select({
              repoFullName: githubRepoConfig.repoFullName,
              baseBranch: githubRepoConfig.baseBranch,
            })
            .from(githubRepoConfig)
            .where(eq(githubRepoConfig.connectionId, conn.id))
            .catch(() => []),
        ])
        if (overview) {
          const baseByRepo = new Map(
            configRows.map((r) => [r.repoFullName, r.baseBranch])
          )
          repoCount = overview.repos.length
          repos = overview.repos.slice(0, MAX_REPOS).map((r) => ({
            fullName: r.fullName,
            private: r.private,
            defaultBranch: r.defaultBranch,
            baseBranch: baseByRepo.get(r.fullName) ?? null,
          }))
          manageUrl = overview.manageUrl
        }
      }
      const configuredUrl = connectUrlFor(descriptor, {
        slug: workspace.slug,
        userId: c.var.user.id,
      })
      return {
        id: descriptor.id,
        name: descriptor.label,
        description: descriptor.description,
        capabilities: connectorCapabilities(descriptor.id).map(
          (capability) => ({
            key: capability.key,
            label: capability.label,
            description: capability.description,
          })
        ),
        connected: !!conn,
        accountLogin: conn?.accountLogin ?? null,
        connectionId: conn?.id ?? null,
        authType: descriptor.authType,
        canManage,
        // Whether the connector is configured server-side — independent of the
        // caller's permission. api-key connectors have no connect URL; they only
        // need the encryption key configured to accept pasted credentials.
        available:
          descriptor.authType === "api-key"
            ? Boolean(env.INTEGRATION_ENCRYPTION_KEY)
            : configuredUrl !== null,
        connectUrl: canManage ? configuredUrl : null,
        repos,
        repoCount,
        manageUrl,
        events: CONNECTOR_EVENTS[descriptor.id].map((e) => {
          const trigger = conn
            ? triggerByEvent.get(`${conn.id}:${e.key}`)
            : undefined
          return {
            key: e.key,
            label: e.label,
            channelId: trigger?.channelId ?? null,
            post: trigger?.post ?? true,
            remember: trigger?.remember ?? false,
            rememberHint: trigger?.rememberHint ?? null,
            actInstructions: trigger?.actInstructions ?? null,
            // Unconfigured events show the same defaults a new trigger gets.
            actWindowSeconds:
              trigger?.actWindowSeconds ?? ACT_DEFAULTS.windowSeconds,
            hourlyRunCap: trigger?.hourlyRunCap ?? ACT_DEFAULTS.hourlyRunCap,
            dailyRunCap: trigger?.dailyRunCap ?? ACT_DEFAULTS.dailyRunCap,
            lastAct: trigger ? (lastActs.get(trigger.id) ?? null) : null,
          }
        }),
      }
    })
  )

  return c.json({ providers }, HttpStatusCodes.OK)
}

export const startGithubConnect: AppRouteHandler<
  StartGithubConnectRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const user = c.var.user

  const url = githubInstallUrl(signOAuthState(workspace.slug, user.id))
  if (!url) {
    return c.json(
      { success: false, message: "GitHub isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // Best effort: a fresh install returns the signed state on its own.
  await recordGithubConnectIntent(user.id, workspace.id).catch((err) =>
    logger.warn({ err }, "GitHub connect intent not recorded")
  )
  return c.json({ url }, HttpStatusCodes.OK)
}

// GitHub's Setup URL page posts here. Session-scoped because the workspace
// isn't in the URL: the signed state names it on a fresh install, and the
// connect intent covers the configure-page redirect that drops `state`.
export const completeGithubSetup: AppRouteHandler<
  CompleteGithubSetupRoute
> = async (c) => {
  const user = c.var.user
  const { installationId, state } = c.req.valid("json")

  const stateSlug = state ? verifyOAuthState(state, user.id) : null
  const intentWorkspaceId = stateSlug
    ? null
    : await readGithubConnectIntent(user.id).catch(() => null)
  const target = stateSlug
    ? eq(schema.workspace.slug, stateSlug)
    : intentWorkspaceId
      ? eq(schema.workspace.id, intentWorkspaceId)
      : null
  const workspace = target
    ? await db
        .select({
          id: schema.workspace.id,
          slug: schema.workspace.slug,
          ownerId: schema.workspace.ownerId,
        })
        .from(schema.workspace)
        .where(target)
        .limit(1)
        .then((rows) => rows[0])
    : undefined
  if (!workspace) {
    return c.json(
      {
        success: false,
        message: "This GitHub connection expired. Start it again from Lor.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const member = await db
    .select({
      userId: schema.workspaceMember.userId,
      role: schema.workspaceMember.role,
    })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspace.id),
        eq(schema.workspaceMember.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  assertWorkspaceAuthority(await resolveWorkspaceAuthority(member, workspace), {
    connector: ["manage"],
  })

  // Require a verifiable installation — don't persist fabricated ids or ones
  // the server can't actually reach (App not configured / invalid).
  const verified = await getSourceProvider("github")
    ?.verifyConnection({ externalId: installationId })
    .catch(() => null)
  if (!verified) {
    return c.json(
      { success: false, message: "Couldn't verify the GitHub installation" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const accountLogin = verified.accountLabel ?? null

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "github",
    externalId: installationId,
    clearOnRevoke: {},
    values: { accountLogin },
  })
  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This GitHub installation is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  // A (re)install can change the selected repos — drop any stale cached list.
  await invalidateGithubRepoCache(installationId)
  await clearGithubConnectIntent(user.id).catch(() => {})

  return c.json(
    { success: true as const, workspaceSlug: workspace.slug, accountLogin },
    HttpStatusCodes.OK
  )
}

type ConnectionWrite = Partial<typeof integrationConnection.$inferInsert>

// Shared connect transaction: serialize concurrent connects for this
// workspace+provider (advisory lock, held until commit/rollback), refuse an
// externalId connected to another workspace, retire this workspace's other
// active rows (wiping their secrets via clearOnRevoke), and upsert the new
// connection. Returns false when the externalId is connected elsewhere.
async function replaceActiveConnection(opts: {
  workspaceId: string
  provider: ConnectorDescriptor["id"]
  externalId: string
  clearOnRevoke: ConnectionWrite
  values: ConnectionWrite
  // Upsert set when it differs from the insert values (defaults to values).
  set?: ConnectionWrite
  // Take over another workspace's revoked row. Only for external ids the
  // connect itself proves (OAuth code exchange, verified keys); a GitHub
  // installation id is client-supplied, so GitHub never reclaims.
  reclaimRevoked?: boolean
}): Promise<boolean> {
  const { workspaceId, provider, externalId } = opts
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${provider}`}, 0))`
    )

    const existing = await tx
      .select({
        id: integrationConnection.id,
        workspaceId: integrationConnection.workspaceId,
        status: integrationConnection.status,
      })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, provider),
          eq(integrationConnection.externalId, externalId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspaceId) {
      if (existing.status !== "revoked" || !opts.reclaimRevoked) return false
      // A revoked row (replaced or suspended) no longer serves its old
      // workspace, and retrieval already ignores its sources. Delete it, with
      // its triggers and repo config, so the external id can move here.
      await tx
        .delete(integrationConnection)
        .where(eq(integrationConnection.id, existing.id))
    }

    await tx
      .update(integrationConnection)
      .set({ status: "revoked", ...opts.clearOnRevoke })
      .where(
        and(
          eq(integrationConnection.workspaceId, workspaceId),
          eq(integrationConnection.provider, provider),
          eq(integrationConnection.status, "active"),
          ne(integrationConnection.externalId, externalId)
        )
      )

    const written = await tx
      .insert(integrationConnection)
      .values({
        workspaceId,
        provider,
        externalId,
        status: "active",
        ...opts.values,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        // Guards the reassignment race the pre-check can't: only update a row
        // this workspace already owns.
        set: { workspaceId, status: "active", ...(opts.set ?? opts.values) },
        setWhere: eq(integrationConnection.workspaceId, workspaceId),
      })
      .returning({ id: integrationConnection.id })

    return written.length > 0
  })
}

// Every OAuth connector stores the same rotating-credential columns; wipe them
// all when retiring a row.
const OAUTH_TOKEN_WIPE = {
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  scope: null,
  // A revoked row must not keep a stale webhook binding — the receiver looks
  // connections up by webhookId.
  webhookId: null,
  webhookSecret: null,
} satisfies ConnectionWrite

export const connectLinear: AppRouteHandler<ConnectLinearRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  // Verify the signed OAuth state before spending the code: it must be minted
  // for this user and bound to this workspace (blocks connection fixation).
  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Exchange the code for tokens + resolve the org (returns encrypted tokens).
  const result = await exchangeLinearCode(code, linearRedirectUri()).catch(
    () => null
  )
  if (!result) {
    return c.json(
      { success: false, message: "Couldn't connect Linear" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "linear",
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Linear workspace is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectDatadog: AppRouteHandler<ConnectDatadogRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { site, apiKey, appKey } = c.req.valid("json")

  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    return c.json(
      { success: false, message: "Datadog isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Verify the keys can actually read logs before persisting (returns them
  // encrypted, with the external id fingerprinted from the API key).
  const result = await verifyDatadogKeys({ site, apiKey, appKey }).catch(
    () => null
  )
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't verify the Datadog keys — check the site, API key, and that the application key can read logs",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "datadog",
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, appKey: null, site: null },
    values: {
      accountLogin: result.accountLabel,
      apiKey: result.apiKey,
      appKey: result.appKey,
      site,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "These Datadog keys are connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectCloudwatch: AppRouteHandler<
  ConnectCloudwatchRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { region, accessKeyId, secretAccessKey } = c.req.valid("json")

  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    return c.json(
      {
        success: false,
        message: "CloudWatch isn't available on this server",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Verify the keys can resolve their account and read logs before
  // persisting (returns them encrypted, external id = the AWS account id).
  const result = await verifyCloudwatchKeys({
    region,
    accessKeyId,
    secretAccessKey,
  }).catch(() => null)
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't verify the AWS credentials — check the region, access key, and that the key can read CloudWatch logs",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "cloudwatch",
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, appKey: null, site: null },
    values: {
      accountLogin: result.accountLabel,
      apiKey: result.accessKeyId,
      appKey: result.secretAccessKey,
      site: region,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This AWS account is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectAttio: AppRouteHandler<ConnectAttioRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const result = await exchangeAttioCode(code, attioRedirectUri(), {
    targetUrl: attioWebhookTargetUrl(),
    eventTypes: Object.keys(ATTIO_EVENT_SUBSCRIPTIONS),
  }).catch(() => null)
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't connect Attio — verify the app has every required read scope plus webhook:read-write, and no other write scopes",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // A reconnect to a DIFFERENT Attio workspace revokes the old row and wipes
  // its webhookId/token (OAUTH_TOKEN_WIPE) — capture them first so the old
  // provider-side webhook can be deleted, like the disconnect path does.
  const outgoing = await db
    .select({
      externalId: integrationConnection.externalId,
      webhookId: integrationConnection.webhookId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.provider, "attio"),
        eq(integrationConnection.status, "active"),
        ne(integrationConnection.externalId, result.externalId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const outgoingToken = outgoing?.webhookId
    ? await getAttioAccessToken(outgoing.externalId).catch(() => null)
    : null

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "attio",
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
      webhookId: result.webhookId,
      webhookSecret: result.webhookSecret,
    },
    // Attio issues no refresh token; a reused row must not keep a stale one.
    set: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: null,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
      webhookId: result.webhookId,
      webhookSecret: result.webhookSecret,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Attio workspace is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  if (outgoingToken && outgoing?.webhookId) {
    // Best effort — a leftover webhook just degrades on Attio's side.
    void deleteAttioWebhook(outgoingToken, outgoing.webhookId)
  } else if (outgoing?.webhookId) {
    // No token means no way to delete it — leave a trace of the leak.
    logger.warn(
      { webhookId: outgoing.webhookId, externalId: outgoing.externalId },
      "Old Attio webhook left registered; token unavailable for cleanup"
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectNotion: AppRouteHandler<ConnectNotionRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const result = await exchangeNotionCode(code, notionRedirectUri()).catch(
    () => null
  )
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't connect Notion — verify the connection has Read content, Read comments, and user information without email addresses",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "notion",
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      providerWorkspaceId: result.providerWorkspaceId,
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: null,
      scope: result.scope,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Notion authorization is connected elsewhere",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const updateIntegration: AppRouteHandler<
  UpdateIntegrationRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")
  const {
    event,
    channelId,
    post,
    remember,
    rememberHint,
    actInstructions,
    actWindowSeconds,
    hourlyRunCap,
    dailyRunCap,
  } = c.req.valid("json")

  const connection = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  if (!isConnectorEvent(connection.provider, event)) {
    return c.json(
      { success: false, message: "Unknown event for this connector" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  if (channelId === null) {
    await db
      .delete(connectorTrigger)
      .where(
        and(
          eq(connectorTrigger.connectionId, connection.id),
          eq(connectorTrigger.event, event)
        )
      )
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  }

  const target = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(
        eq(channel.id, channelId),
        eq(channel.workspaceId, workspace.id),
        eq(channel.type, "text")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  // A trigger must not be pointed at a channel the configuring user can't
  // see — that would let an admin exfiltrate a private channel's replies.
  if (!target || !(await userCanAccessChannel(channelId, c.var.user.id))) {
    return c.json(
      { success: false, message: "Channel not found in this workspace" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  await db
    .insert(connectorTrigger)
    .values({
      connectionId: connection.id,
      event,
      channelId,
      post,
      remember,
      rememberHint,
      actInstructions,
      // Absent = keep the column default on create.
      ...(actWindowSeconds !== undefined ? { actWindowSeconds } : {}),
      ...(hourlyRunCap !== undefined ? { hourlyRunCap } : {}),
      ...(dailyRunCap !== undefined ? { dailyRunCap } : {}),
    })
    .onConflictDoUpdate({
      target: [connectorTrigger.connectionId, connectorTrigger.event],
      set: {
        channelId,
        post,
        remember,
        rememberHint,
        actInstructions,
        // Absent = leave the configured limits alone.
        ...(actWindowSeconds !== undefined ? { actWindowSeconds } : {}),
        ...(hourlyRunCap !== undefined ? { hourlyRunCap } : {}),
        ...(dailyRunCap !== undefined ? { dailyRunCap } : {}),
      },
    })

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const updateGithubRepoConfig: AppRouteHandler<
  UpdateGithubRepoConfigRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")
  const { repoFullName, baseBranch } = c.req.valid("json")

  const connection = await db
    .select({
      id: integrationConnection.id,
      externalId: integrationConnection.externalId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.provider, "github"),
        eq(integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const repos = await listInstallationRepos(connection.externalId)
  const repo = repos.find(
    (r) => r.fullName.toLowerCase() === repoFullName.toLowerCase()
  )
  if (!repo) {
    return c.json(
      { success: false, message: "Repository not found in this installation" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Explicitly choosing the default branch = no override; keep the table to
  // real deviations so a repo default-branch rename isn't silently pinned.
  if (baseBranch === null || baseBranch === repo.defaultBranch) {
    await db
      .delete(githubRepoConfig)
      .where(
        and(
          eq(githubRepoConfig.connectionId, connection.id),
          eq(githubRepoConfig.repoFullName, repo.fullName)
        )
      )
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  }

  const exists = await branchExists(
    connection.externalId,
    repo.fullName,
    baseBranch
  )
  if (exists === false) {
    return c.json(
      {
        success: false,
        message: `Branch "${baseBranch}" doesn't exist in ${repo.fullName}`,
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (exists === null) {
    return c.json(
      { success: false, message: "Couldn't verify the branch with GitHub" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }

  await db
    .insert(githubRepoConfig)
    .values({
      connectionId: connection.id,
      repoFullName: repo.fullName,
      baseBranch,
    })
    .onConflictDoUpdate({
      target: [githubRepoConfig.connectionId, githubRepoConfig.repoFullName],
      set: { baseBranch },
    })

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const disconnectIntegration: AppRouteHandler<
  DisconnectIntegrationRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")

  const connection = await db
    .select({
      provider: integrationConnection.provider,
      externalId: integrationConnection.externalId,
      webhookId: integrationConnection.webhookId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // The token is needed to clean up the provider-side webhook, and it's only
  // readable while the connection row still exists — grab it pre-delete.
  const attioToken =
    connection.provider === "attio" && connection.webhookId
      ? await getAttioAccessToken(connection.externalId).catch(() => null)
      : null

  const deleted = await db
    .delete(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .returning({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
      externalId: integrationConnection.externalId,
    })
    .then((rows) => rows[0])

  if (!deleted) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  if (deleted.provider === "github") {
    await invalidateGithubRepoCache(deleted.externalId)
  }
  if (deleted.provider === "attio" && attioToken && connection.webhookId) {
    // Best effort — a leftover webhook just degrades on Attio's side.
    void deleteAttioWebhook(attioToken, connection.webhookId)
  }

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
