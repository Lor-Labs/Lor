import type { IntegrationProvider } from "@repo/db/schema"
import { attioProvider } from "./attio"
import { betterstackProvider } from "./betterstack"
import { cloudwatchProvider } from "./cloudwatch"
import { datadogProvider } from "./datadog"
import { fetchGithubSourceItem, githubProvider } from "./github"
import { linearProvider } from "./linear"
import { notionProvider } from "./notion"
import type { SourceFetcher, SourceProvider } from "./types"
import { webhookProvider } from "./webhook"

// Exhaustive over integrationProviderEnum — a new provider value without a
// SourceProvider here is a compile error (was a silent Partial map before).
const providers: Record<IntegrationProvider, SourceProvider> = {
  github: githubProvider,
  linear: linearProvider,
  datadog: datadogProvider,
  attio: attioProvider,
  notion: notionProvider,
  cloudwatch: cloudwatchProvider,
  betterstack: betterstackProvider,
  webhook: webhookProvider,
}

export function getSourceProvider(
  provider: IntegrationProvider
): SourceProvider {
  return providers[provider]
}

// Providers whose items are ingested into `source`, each with its refetch.
// reference/planned/context-engine-phase-2.md.
export const SOURCE_FETCHERS = {
  github: fetchGithubSourceItem,
} satisfies Partial<Record<IntegrationProvider, SourceFetcher>>

export type IngestedProvider = keyof typeof SOURCE_FETCHERS

export function isIngestedProvider(
  provider: IntegrationProvider
): provider is IngestedProvider {
  return provider in SOURCE_FETCHERS
}

export {
  ATTIO_REQUIRED_READ_SCOPES,
  ATTIO_WEBHOOK_SCOPE,
  ATTIO_WRITE_SCOPES,
  type AttioCallRecording,
  type AttioTranscriptSegment,
  attioRequest,
  connectAttio,
  deleteAttioWebhook,
  fetchAttioCallRecording,
  formatAttioTranscript,
  getAttioAccessToken,
} from "./attio"
export { connectBetterstack } from "./betterstack"
export { connectCloudwatch } from "./cloudwatch"
export { connectDatadog } from "./datadog"
export {
  branchExists,
  type FetchedIssue,
  fetchIssueOrPr,
  getInstallationOverview,
  type InstallationRepo,
  type IssueSearchHit,
  listInstallationRepos,
  searchIssues,
} from "./github"
export { connectLinear, getLinearAccessToken } from "./linear"
export {
  connectNotion,
  getNotionAccessToken,
  NOTION_API_VERSION,
  NOTION_REQUIRED_CAPABILITIES,
  notionCall,
} from "./notion"
export type {
  ConnectionRef,
  SourceFetch,
  SourceFetcher,
  SourceProvider,
} from "./types"
