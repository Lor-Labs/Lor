import type { Webhooks } from "@octokit/webhooks"
import type { ConnectorEventKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { githubNotificationEmbed } from "@/lib/connector-notification-embeds"
import {
  dispatchConnectorEvent,
  type RememberDraft,
} from "@/lib/connector-triggers"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"

const toDate = (s?: string | null): Date | null => (s ? new Date(s) : null)

// Fan the event out to its trigger's configured effects (POST / Remember).
// Skips silently when the install isn't mapped to a workspace or the event
// has no trigger — no row = event off.
async function dispatchForInstallation(
  installationId: number | undefined,
  event: ConnectorEventKey,
  text: string,
  embed: ReturnType<typeof githubNotificationEmbed>,
  remember?: RememberDraft
): Promise<void> {
  if (installationId === undefined) return
  await dispatchConnectorEvent({
    provider: "github",
    externalId: String(installationId),
    event,
    label: "GitHub",
    text,
    embeds: [embed],
    remember,
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
        kind: "pull_request",
        externalId: `${repo}#${pr.number}`,
        title: pr.title,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        occurredAt: toDate(pr.created_at),
        content: `${pr.title}\n\n${pr.body ?? ""}`,
      }
    )
  })

  // Merged PRs — high-signal units of change. Shares the opened PR's
  // externalId, so remembering both upserts one source row in place.
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
        kind: "pull_request",
        externalId: `${repo}#${pr.number}`,
        title: pr.title,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        occurredAt: toDate(pr.merged_at),
        content: `${pr.title}\n\n${pr.body ?? ""}`,
      }
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
        kind: "issue",
        externalId: `${repo}#${issue.number}`,
        title: issue.title,
        url: issue.html_url,
        author: issue.user?.login ?? null,
        occurredAt: toDate(
          payload.action === "closed" ? issue.closed_at : issue.created_at
        ),
        content: `${issue.title}\n\n${issue.body ?? ""}`,
      }
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
        kind: "release",
        externalId: `${repo}@${release.id}`,
        title,
        url: release.html_url,
        author: release.author?.login ?? null,
        occurredAt: toDate(release.published_at),
        content: `${title}\n\n${release.body ?? ""}`,
      }
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
