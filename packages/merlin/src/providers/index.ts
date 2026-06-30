import type { IntegrationProvider } from "@repo/db/schema"
import { githubProvider } from "./github"
import { linearProvider } from "./linear"
import type { SourceProvider } from "./types"

// Exhaustive over integrationProviderEnum — a new provider value without a
// SourceProvider here is a compile error (was a silent Partial map before).
const providers: Record<IntegrationProvider, SourceProvider> = {
  github: githubProvider,
  linear: linearProvider,
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
export { connectLinear, getLinearAccessToken } from "./linear"
export type { ConnectionRef, SourceProvider, SourceRef } from "./types"
