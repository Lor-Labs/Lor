import { CONNECTOR_LIST, type ConnectorDescriptor } from "@repo/connectors"
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
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
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

// The connect entry point per auth type. The `state` round-trips back to the
// callback/setup redirect: OAuth uses a short-lived signed state (CSRF-bound to
// the user + workspace); the GitHub App install carries the raw slug. null → the
// connector shows as Unavailable.
function connectUrlFor(
  descriptor: ConnectorDescriptor,
  ctx: { slug: string; userId: string }
): string | null {
  switch (descriptor.authType) {
    case "github-app":
      return env.GITHUB_APP_SLUG
        ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${ctx.slug}`
        : null
    case "oauth":
      // Linear is the only OAuth connector today; per-descriptor OAuth config
      // will generalize this when a second lands.
      return descriptor.id === "linear"
        ? linearConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        : null
    case "api-key":
      // Keyed connectors are entered in-app, not via a redirect.
      return null
  }
}

export const listIntegrations: AppRouteHandler<ListIntegrationsRoute> = async (
  c
) => {
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
      let repos: { fullName: string; private: boolean }[] | null = null
      let repoCount: number | null = null
      let manageUrl: string | null = null
      if (descriptor.id === "github" && conn) {
        const overview = await getInstallationOverview(conn.externalId).catch(
          () => null
        )
        if (overview) {
          repoCount = overview.repos.length
          repos = overview.repos
            .slice(0, MAX_REPOS)
            .map((r) => ({ fullName: r.fullName, private: r.private }))
          manageUrl = overview.manageUrl
        }
      }
      return {
        id: descriptor.id,
        name: descriptor.label,
        connected: !!conn,
        accountLogin: conn?.accountLogin ?? null,
        connectionId: conn?.id ?? null,
        connectUrl: connectUrlFor(descriptor, {
          slug: workspace.slug,
          userId: c.var.user.id,
        }),
        repos,
        repoCount,
        manageUrl,
      }
    })
  )

  return c.json({ providers }, HttpStatusCodes.OK)
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

    // One active Linear connection per workspace: retire any others and wipe
    // their encrypted tokens so stale secrets don't linger on revoked rows.
    await tx
      .update(integrationConnection)
      .set({
        status: "revoked",
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        scope: null,
      })
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
