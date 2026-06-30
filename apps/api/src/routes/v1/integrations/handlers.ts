import { db } from "@repo/db"
import { integrationConnection } from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  connectLinear as exchangeLinearCode,
  getInstallationOverview,
  getSourceProvider,
} from "@repo/merlin/providers"
import { and, eq, ne, sql } from "drizzle-orm"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectGithubRoute,
  ConnectLinearRoute,
  DisconnectIntegrationRoute,
  ListIntegrationsRoute,
} from "@/routes/v1/integrations/routes"

// Used for both the authorize URL and the token exchange — they must match.
const linearRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/linear/callback`

// actor=app: actions are attributed to the Merlin app (and its app user costs
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

export const listIntegrations: AppRouteHandler<ListIntegrationsRoute> = async (
  c
) => {
  const workspace = c.var.workspace

  const github = await db
    .select({
      id: integrationConnection.id,
      accountLogin: integrationConnection.accountLogin,
      externalId: integrationConnection.externalId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.provider, "github"),
        eq(integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  // Surface the installation's accessible repos (read-only) + its GitHub manage
  // URL. Best-effort: a hiccup leaves them null and the card still renders.
  const MAX_REPOS = 100
  let repos: { fullName: string; private: boolean }[] | null = null
  let repoCount: number | null = null
  let manageUrl: string | null = null
  if (github) {
    const overview = await getInstallationOverview(github.externalId).catch(
      () => null
    )
    if (overview) {
      // Keep the true total before capping the list sent to the client.
      repoCount = overview.repos.length
      repos = overview.repos
        .slice(0, MAX_REPOS)
        .map((r) => ({ fullName: r.fullName, private: r.private }))
      manageUrl = overview.manageUrl
    }
  }

  // Install link is built server-side so the App slug stays out of the client.
  // `state` carries the workspace back to the setup redirect.
  if (!env.GITHUB_APP_SLUG) {
    logger.warn(
      { workspaceSlug: workspace.slug },
      "GITHUB_APP_SLUG not set; GitHub integration shows as Unavailable"
    )
  }
  const connectUrl = env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${workspace.slug}`
    : null

  const linear = await db
    .select({
      id: integrationConnection.id,
      accountLogin: integrationConnection.accountLogin,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.provider, "linear"),
        eq(integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  return c.json(
    {
      providers: [
        {
          id: "github",
          name: "GitHub",
          connected: !!github,
          accountLogin: github?.accountLogin ?? null,
          connectionId: github?.id ?? null,
          connectUrl,
          repos,
          repoCount,
          manageUrl,
        },
        {
          id: "linear",
          name: "Linear",
          connected: !!linear,
          accountLogin: linear?.accountLogin ?? null,
          connectionId: linear?.id ?? null,
          connectUrl: linearConnectUrl(workspace.slug),
          repos: null,
          repoCount: null,
          manageUrl: null,
        },
      ],
    },
    HttpStatusCodes.OK
  )
}

export const connectGithub: AppRouteHandler<ConnectGithubRoute> = async (c) => {
  const workspace = c.var.workspace
  const { installationId } = c.req.valid("json")

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

  const ok = await db.transaction(async (tx) => {
    // Serialize concurrent connects for this workspace+provider so the
    // revoke-then-insert below can't interleave into multiple active rows.
    // The lock is held for the transaction and released on commit/rollback.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace.id}:github`}, 0))`
    )

    // The installation is globally unique; don't let one workspace hijack an
    // installation already linked to another.
    const existing = await tx
      .select({ workspaceId: integrationConnection.workspaceId })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, "github"),
          eq(integrationConnection.externalId, installationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspace.id) return false

    // One active GitHub connection per workspace: retire any others.
    await tx
      .update(integrationConnection)
      .set({ status: "revoked" })
      .where(
        and(
          eq(integrationConnection.workspaceId, workspace.id),
          eq(integrationConnection.provider, "github"),
          eq(integrationConnection.status, "active"),
          ne(integrationConnection.externalId, installationId)
        )
      )

    const written = await tx
      .insert(integrationConnection)
      .values({
        workspaceId: workspace.id,
        provider: "github",
        externalId: installationId,
        accountLogin,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        set: { workspaceId: workspace.id, accountLogin, status: "active" },
        // Guards the reassignment race the pre-check can't: only update a row
        // this workspace already owns.
        setWhere: eq(integrationConnection.workspaceId, workspace.id),
      })
      .returning({ id: integrationConnection.id })

    // setWhere blocked the update → the installation is owned elsewhere.
    return written.length > 0
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

  return c.json({ success: true as const, accountLogin }, HttpStatusCodes.OK)
}

export const connectLinear: AppRouteHandler<ConnectLinearRoute> = async (c) => {
  const workspace = c.var.workspace
  const { code } = c.req.valid("json")

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

  const ok = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace.id}:linear`}, 0))`
    )

    // The Linear org is globally unique; don't let one workspace hijack an org
    // already linked to another.
    const existing = await tx
      .select({ workspaceId: integrationConnection.workspaceId })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, "linear"),
          eq(integrationConnection.externalId, result.externalId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspace.id) return false

    // One active Linear connection per workspace: retire any others.
    await tx
      .update(integrationConnection)
      .set({ status: "revoked" })
      .where(
        and(
          eq(integrationConnection.workspaceId, workspace.id),
          eq(integrationConnection.provider, "linear"),
          eq(integrationConnection.status, "active"),
          ne(integrationConnection.externalId, result.externalId)
        )
      )

    const written = await tx
      .insert(integrationConnection)
      .values({
        workspaceId: workspace.id,
        provider: "linear",
        externalId: result.externalId,
        accountLogin: result.accountLabel,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenExpiresAt: result.tokenExpiresAt,
        scope: result.scope,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        set: {
          workspaceId: workspace.id,
          accountLogin: result.accountLabel,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenExpiresAt: result.tokenExpiresAt,
          scope: result.scope,
          status: "active",
        },
        setWhere: eq(integrationConnection.workspaceId, workspace.id),
      })
      .returning({ id: integrationConnection.id })

    return written.length > 0
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

export const disconnectIntegration: AppRouteHandler<
  DisconnectIntegrationRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")

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

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
