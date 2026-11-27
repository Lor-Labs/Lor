import { resolveAgentCapabilities } from "./capabilities"
import { resolveWorkspaceGithub } from "./github"
import type { InstallationRepo } from "./providers/github"

export { listRepoBranches } from "./providers/github"

// The names become a folder path and git arguments, so `.` and `..` segments
// are refused (clone_repo can pass an unlisted name through).
export const REPO_FULL_NAME =
  /^(?!\.{1,2}\/)(?![A-Za-z0-9._-]+\/\.{1,2}$)[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/

export function isSafeBranch(branch: string): boolean {
  return (
    BRANCH.test(branch) &&
    !branch.includes("..") &&
    !branch.startsWith("-") &&
    !branch.startsWith("/")
  )
}

// A code session's repo must be one its agent may read: the agent's tools
// (else the workspace default, for a session a person starts) include
// clone_repo, and the workspace's GitHub installation lists the repo.
export async function allowedCodeRepo(
  workspaceId: string,
  agentId: string | null,
  requested: string
): Promise<{ installationId: string; repo: InstallationRepo } | null> {
  const grants = await resolveAgentCapabilities(agentId, workspaceId).catch(
    () => null
  )
  if (!grants?.connectorTools.includes("clone_repo")) return null
  const github = await resolveWorkspaceGithub(workspaceId).catch(() => null)
  const want = requested.trim().toLowerCase()
  const repo = github?.repos.find((r) => r.fullName.toLowerCase() === want)
  if (!(github && repo && REPO_FULL_NAME.test(repo.fullName))) return null
  return { installationId: github.installationId, repo }
}
