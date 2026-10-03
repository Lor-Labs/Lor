import type { VoiceBlock } from "@repo/db/schema"
import { activeGithubInstallation } from "./github"
import {
  activeLinearConnection,
  type LinearIssueCard,
  loadLinearIssueCards,
} from "./linear"
import { fetchPullRequestCard, type PullRequestCard } from "./providers/github"
import { GITHUB_PULL_REF, LINEAR_IDENTIFIER } from "./voice"

export type { LinearIssueCard, PullRequestCard }

export type VoiceEntityCards = {
  linear: { connected: boolean; issues: LinearIssueCard[] }
  github: { connected: boolean; pullRequests: PullRequestCard[] }
}

// Live data for the entity blocks in Lor's window, read with the workspace's
// connections each time the window refreshes. A reference that doesn't load
// is missing from the result; the window shows it as unavailable.
export async function loadVoiceEntityCards(
  workspaceId: string,
  blocks: VoiceBlock[]
): Promise<VoiceEntityCards> {
  const identifiers = new Set<string>()
  const pullRefs = new Set<string>()
  for (const block of blocks) {
    if (block.type === "linear_issues") {
      for (const id of block.issues) {
        if (LINEAR_IDENTIFIER.test(id)) identifiers.add(id)
      }
    } else if (block.type === "github_pull_requests") {
      for (const ref of block.pullRequests) {
        if (GITHUB_PULL_REF.test(ref)) pullRefs.add(ref)
      }
    }
  }

  const [linearConnection, installation] = await Promise.all([
    identifiers.size > 0 ? activeLinearConnection(workspaceId) : null,
    pullRefs.size > 0 ? activeGithubInstallation(workspaceId) : null,
  ])
  const [issues, pullRequests] = await Promise.all([
    linearConnection
      ? loadLinearIssueCards(linearConnection, [...identifiers]).catch(() => [])
      : [],
    installation
      ? Promise.all(
          [...pullRefs].map((ref) => fetchPullRequestCard(installation, ref))
        ).then((cards) => cards.filter((card) => card !== null))
      : [],
  ])
  return {
    linear: { connected: linearConnection !== null, issues },
    github: { connected: installation !== null, pullRequests },
  }
}
