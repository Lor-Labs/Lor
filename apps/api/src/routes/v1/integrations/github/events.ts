import type { Webhooks } from "@octokit/webhooks"
import {
  type ConnectorEventKey,
  githubItemKey,
  githubRepoKey,
} from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { tombstoneSource, tombstoneSourcesWithPrefix } from "@repo/lor/sources"
import { githubNotificationEmbed } from "@/lib/connector-notification-embeds"
import {
  dispatchConnectorEvent,
  type EventItem,
} from "@/lib/connector-triggers"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import {
  enqueueSourceIngest,
  ingestConnection,
} from "@/lib/source-ingest-queue"

function ingestConnectionFor(installationId: number | undefined) {
  return installationId === undefined
    ? Promise.resolve(null)
    : ingestConnection("github", String(installationId))
}

// Ingestion runs whether or not a trigger exists: any change to a PR or issue
// or its discussion refetches the item. See
// reference/planned/context-engine-phase-2.md Step 3.
async function ingestItem(
  installationId: number | undefined,
  repo: string,
  number: number,
  kind: "pull_request" | "issue"
): Promise<void> {
  const connection = await ingestConnectionFor(installationId)
  if (!connection) return
  await enqueueSourceIngest(connection.id, kind, githubItemKey(repo, number))
}

// Fan the event out to its trigger's configured effects (POST / Act).
// Skips silently when the install isn't mapped to a workspace or the event
// has no trigger — no row = event off.
async function dispatchForInstallation(
  installationId: number | undefined,
  event: ConnectorEventKey,
  text: string,
  embed: ReturnType<typeof githubNotificationEmbed>,
  item: EventItem,
  ingested: boolean
): Promise<void> {
  if (installationId === undefined) return
  await dispatchConnectorEvent({
    provider: "github",
    externalId: String(installationId),
    event,
    label: "GitHub",
    text,
    embeds: [embed],
    item,
    ingested,
  })
}

// Register the salient events. Payloads are fully typed by @octokit/webhooks.
export function registerGithubHandlers(webhooks: Webhooks): void {
  webhooks.on("pull_request.opened", async ({ payload }) => {
    const pr = payload.pull_request
    const repo = payload.repository.full_name
    await dispatchForInstallation(
      payload.installation?.id,
      "pr_opened",
      `**${pr.draft ? "Draft PR" : "PR"} opened** [${repo}#${pr.number}](${pr.html_url}) ${pr.title}${pr.user ? ` — by ${pr.user.login}` : ""}`,
      githubNotificationEmbed({
        event: `${pr.draft ? "Draft pull request" : "Pull request"} opened`,
        title: pr.title,
        url: pr.html_url,
        repository: repo,
        reference: String(pr.number),
        body: pr.body,
        actor: pr.user
          ? {
              name: pr.user.login,
              url: pr.user.html_url,
              avatarUrl: pr.user.avatar_url,
            }
          : null,
      }),
      {
        title: pr.title,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        content: `${pr.title}\n\n${pr.body ?? ""}`,
      },
      true
    )
  })

  // Merged PRs — high-signal units of change.
  webhooks.on("pull_request.closed", async ({ payload }) => {
    const pr = payload.pull_request
    if (!pr.merged) return
    const repo = payload.repository.full_name
    await dispatchForInstallation(
      payload.installation?.id,
      "pr_merged",
      `**PR merged** [${repo}#${pr.number}](${pr.html_url}) ${pr.title}${pr.user ? ` — by ${pr.user.login}` : ""}`,
      githubNotificationEmbed({
        event: "Pull request merged",
        title: pr.title,
        url: pr.html_url,
        repository: repo,
        reference: String(pr.number),
        body: pr.body,
        actor: pr.user
          ? {
              name: pr.user.login,
              url: pr.user.html_url,
              avatarUrl: pr.user.avatar_url,
            }
          : null,
      }),
      {
        title: pr.title,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        content: `${pr.title}\n\n${pr.body ?? ""}`,
      },
      true
    )
  })

  webhooks.on(["issues.opened", "issues.closed"], async ({ payload }) => {
    const issue = payload.issue
    const repo = payload.repository.full_name
    await dispatchForInstallation(
      payload.installation?.id,
      payload.action === "opened" ? "issue_opened" : "issue_closed",
      `**Issue ${payload.action}** [${repo}#${issue.number}](${issue.html_url}) ${issue.title}${issue.user ? ` — by ${issue.user.login}` : ""}`,
      githubNotificationEmbed({
        event: `Issue ${payload.action}`,
        title: issue.title,
        url: issue.html_url,
        repository: repo,
        reference: String(issue.number),
        body: issue.body,
        actor: issue.user
          ? {
              name: issue.user.login,
              url: issue.user.html_url,
              avatarUrl: issue.user.avatar_url,
            }
          : null,
      }),
      {
        title: issue.title,
        url: issue.html_url,
        author: issue.user?.login ?? null,
        content: `${issue.title}\n\n${issue.body ?? ""}`,
      },
      true
    )
  })

  webhooks.on("release.published", async ({ payload }) => {
    const release = payload.release
    const repo = payload.repository.full_name
    const title = release.name ?? release.tag_name
    await dispatchForInstallation(
      payload.installation?.id,
      "release_published",
      `**Release published** [${title}](${release.html_url}) — ${repo}`,
      githubNotificationEmbed({
        event: "Release published",
        title,
        url: release.html_url,
        repository: repo,
        body: release.body,
        actor: release.author
          ? {
              name: release.author.login,
              url: release.author.html_url,
              avatarUrl: release.author.avatar_url,
            }
          : null,
      }),
      {
        title,
        url: release.html_url,
        author: release.author?.login ?? null,
        content: `${title}\n\n${release.body ?? ""}`,
      },
      false
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

  // Ingestion signals. The fetch reads the whole item, so the action only
  // says something changed.
  webhooks.on(
    [
      "pull_request.opened",
      "pull_request.edited",
      "pull_request.closed",
      "pull_request.reopened",
      "pull_request.ready_for_review",
      "pull_request.converted_to_draft",
      "pull_request_review.submitted",
      "pull_request_review.edited",
      "pull_request_review.dismissed",
      "pull_request_review_comment.created",
      "pull_request_review_comment.edited",
      "pull_request_review_comment.deleted",
    ],
    ({ payload }) =>
      ingestItem(
        payload.installation?.id,
        payload.repository.full_name,
        payload.pull_request.number,
        "pull_request"
      )
  )

  webhooks.on(
    [
      "issues.opened",
      "issues.edited",
      "issues.closed",
      "issues.reopened",
      "issue_comment.created",
      "issue_comment.edited",
      "issue_comment.deleted",
    ],
    ({ payload }) =>
      ingestItem(
        payload.installation?.id,
        payload.repository.full_name,
        payload.issue.number,
        payload.issue.pull_request ? "pull_request" : "issue"
      )
  )

  // Deleted, or moved to another repo: the old key is gone. A transferred
  // issue is fetched under its new key.
  webhooks.on(["issues.deleted", "issues.transferred"], async ({ payload }) => {
    const connection = await ingestConnectionFor(payload.installation?.id)
    if (!connection) return
    await tombstoneSource(
      connection.id,
      githubItemKey(payload.repository.full_name, payload.issue.number)
    )
    if (payload.action === "transferred") {
      await enqueueSourceIngest(
        connection.id,
        "issue",
        githubItemKey(
          payload.changes.new_repository.full_name,
          payload.changes.new_issue.number
        )
      )
    }
  })

  webhooks.on("installation_repositories.removed", async ({ payload }) => {
    const connection = await ingestConnectionFor(payload.installation.id)
    if (!connection) return
    for (const repo of payload.repositories_removed) {
      await tombstoneSourcesWithPrefix(
        connection.id,
        `${githubRepoKey(repo.full_name)}#`
      )
    }
  })

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
