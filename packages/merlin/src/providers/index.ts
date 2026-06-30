import type { IntegrationProvider } from "@repo/db/schema"
import { githubProvider } from "./github"
import type { SourceProvider } from "./types"

// Exhaustive over integrationProviderEnum — a new provider value without a
// SourceProvider here is a compile error (was a silent Partial map before).
const providers: Record<IntegrationProvider, SourceProvider> = {
  github: githubProvider,
}

export function getSourceProvider(
  provider: IntegrationProvider
): SourceProvider {
  return providers[provider]
}

export {
  type FetchedIssue,
  fetchIssueOrPr,
  getInstallationOverview,
  type InstallationRepo,
  type IssueSearchHit,
  listInstallationRepos,
  searchIssues,
} from "./github"
export type { ConnectionRef, SourceProvider, SourceRef } from "./types"
