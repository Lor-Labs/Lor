import type { Webhooks } from "@octokit/webhooks"
import { recordUsage } from "@repo/billing"
import type { ConnectorEventKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { type IngestSourceInput, ingestSource } from "@repo/merlin/sources"
import { postConnectorNotification } from "@/lib/connector-notifications"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import { logger } from "@/lib/logger"

// What a handler hands to ingestSource, minus the fields we resolve here.
type IngestDraft = Omit<
  IngestSourceInput,
  "workspaceId" | "connectionId" | "provider"
>

const toDate = (s?: string | null): Date | null => (s ? new Date(s) : null)

// Source ingest (summarize + embed PR/issue/release into `source`) is PAUSED
// while GitHub moves to a sandbox + brain-centric model (§7.4 — code via the
// sandbox; PRs/issues live-fetched on demand, not mirrored). The webhook
// wiring stays live for lifecycle + channel notifications; flip this to
// re-enable embedding if that proves valuable.
const SOURCE_INGEST_ENABLED: boolean = false

// Resolve the workspace this installation is linked to, then ingest. Skips
// silently when the install isn't mapped to a workspace yet (setup flow later).
async function ingestForInstallation(
  installationId: number | undefined,
  draft: IngestDraft
): Promise<void> {
  if (!SOURCE_INGEST_ENABLED) return
  if (installationId === undefined) return
  const connection = await db
    .select({
      id: schema.integrationConnection.id,
      workspaceId: schema.integrationConnection.workspaceId,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "github"),
        eq(schema.integrationConnection.externalId, String(installationId)),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!connection) return

  await ingestSource(
    {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      provider: "github",
      ...draft,
    },
    // Metered at true cost, never debited — "free ingestion" stays a pricing
    // decision whose price is visible in the ledger.
    (u) => void recordUsage(u)
  )
  logger.info(
    { kind: draft.kind, externalId: draft.externalId },
    "Ingested GitHub source"
  )
}

async function notifyForInstallation(
  installationId: number | undefined,
  event: ConnectorEventKey,
  text: string
): Promise<void> {
  if (installationId === undefined) return
  await postConnectorNotification({
    provider: "github",
    externalId: String(installationId),
    event,
    label: "GitHub",
    text,
  })
}

// Register the salient events. Payloads are fully typed by @octokit/webhooks.
export function registerGithubHandlers(webhooks: Webhooks): void {
  // Opened PRs are notify-only: an unmerged description isn't a unit of change
  // worth ingesting. Drafts are labelled rather than dropped.
  webhooks.on("pull_request.opened", async ({ payload }) => {
    const pr = payload.pull_request
    const repo = payload.repository.full_name
    await notifyForInstallation(
      payload.installation?.id,
      "pr_opened",
      `**${pr.draft ? "Draft PR" : "PR"} opened** [${repo}#${pr.number}](${pr.html_url}) ${pr.title}${pr.user ? ` — by ${pr.user.login}` : ""}`
    )
  })

  // Merged PRs — high-signal units of change.
  webhooks.on("pull_request.closed", async ({ payload }) => {
    const pr = payload.pull_request
    if (!pr.merged) return
    const repo = payload.repository.full_name
    await ingestForInstallation(payload.installation?.id, {
      kind: "pull_request",
      externalId: `${repo}#${pr.number}`,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login ?? null,
      occurredAt: toDate(pr.merged_at),
      content: `${pr.title}\n\n${pr.body ?? ""}`,
    })
    await notifyForInstallation(
      payload.installation?.id,
      "pr_merged",
      `**PR merged** [${repo}#${pr.number}](${pr.html_url}) ${pr.title}${pr.user ? ` — by ${pr.user.login}` : ""}`
    )
  })

  webhooks.on(["issues.opened", "issues.closed"], async ({ payload }) => {
    const issue = payload.issue
    const repo = payload.repository.full_name
    await ingestForInstallation(payload.installation?.id, {
      kind: "issue",
      externalId: `${repo}#${issue.number}`,
      title: issue.title,
      url: issue.html_url,
      author: issue.user?.login ?? null,
      occurredAt: toDate(
        payload.action === "closed" ? issue.closed_at : issue.created_at
      ),
      content: `${issue.title}\n\n${issue.body ?? ""}`,
    })
    await notifyForInstallation(
      payload.installation?.id,
      payload.action === "opened" ? "issue_opened" : "issue_closed",
      `**Issue ${payload.action}** [${repo}#${issue.number}](${issue.html_url}) ${issue.title}${issue.user ? ` — by ${issue.user.login}` : ""}`
    )
  })

  webhooks.on("release.published", async ({ payload }) => {
    const release = payload.release
    const repo = payload.repository.full_name
    const title = release.name ?? release.tag_name
    await ingestForInstallation(payload.installation?.id, {
      kind: "release",
      externalId: `${repo}@${release.id}`,
      title,
      url: release.html_url,
      author: release.author?.login ?? null,
      occurredAt: toDate(release.published_at),
      content: `${title}\n\n${release.body ?? ""}`,
    })
    await notifyForInstallation(
      payload.installation?.id,
      "release_published",
      `**Release published** [${title}](${release.html_url}) — ${repo}`
    )
  })

  // Repo access changed on GitHub's side (admin added/removed repos) — drop the
  // cached repo list so the next query reflects it; the TTL is only a backstop.
  webhooks.on(
    ["installation_repositories.added", "installation_repositories.removed"],
    async ({ payload }) => {
      await invalidateGithubRepoCache(String(payload.installation.id))
    }
  )

  // App lifecycle: uninstall drops the connection (sources cascade-purge);
  // suspend/unsuspend toggles status. Workspace mapping is the setup flow.
  webhooks.on(
    ["installation.deleted", "installation.suspend", "installation.unsuspend"],
    async ({ payload }) => {
      // Drop the cached repo list regardless of action (gone/revoked/restored).
      await invalidateGithubRepoCache(String(payload.installation.id))
      const where = and(
        eq(schema.integrationConnection.provider, "github"),
        eq(
          schema.integrationConnection.externalId,
          String(payload.installation.id)
        )
      )
      if (payload.action === "deleted") {
        await db.delete(schema.integrationConnection).where(where)
        return
      }
      await db
        .update(schema.integrationConnection)
        .set({ status: payload.action === "suspend" ? "revoked" : "active" })
        .where(where)
    }
  )
}
