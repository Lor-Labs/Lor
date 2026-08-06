import type { IntegrationProvider } from "@repo/db/schema"
import { attioProvider } from "./attio"
import { datadogProvider } from "./datadog"
import { githubProvider } from "./github"
import { linearProvider } from "./linear"
import type { SourceProvider } from "./types"

// Exhaustive over integrationProviderEnum — a new provider value without a
// SourceProvider here is a compile error (was a silent Partial map before).
const providers: Record<IntegrationProvider, SourceProvider> = {
  github: githubProvider,
  linear: linearProvider,
  datadog: datadogProvider,
  attio: attioProvider,
}

export function getSourceProvider(
  provider: IntegrationProvider
): SourceProvider {
  return providers[provider]
}

export {
  ATTIO_REQUIRED_READ_SCOPES,
  attioRequest,
  connectAttio,
  getAttioAccessToken,
} from "./attio"
export { connectDatadog } from "./datadog"
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
