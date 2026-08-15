import type { IntegrationProvider } from "@repo/db/schema"
import { attioProvider } from "./attio"
import { cloudwatchProvider } from "./cloudwatch"
import { datadogProvider } from "./datadog"
import { githubProvider } from "./github"
import { linearProvider } from "./linear"
import { notionProvider } from "./notion"
import type { SourceProvider } from "./types"

// Exhaustive over integrationProviderEnum — a new provider value without a
// SourceProvider here is a compile error (was a silent Partial map before).
const providers: Record<IntegrationProvider, SourceProvider> = {
  github: githubProvider,
  linear: linearProvider,
  datadog: datadogProvider,
  attio: attioProvider,
  notion: notionProvider,
  cloudwatch: cloudwatchProvider,
}

export function getSourceProvider(
  provider: IntegrationProvider
): SourceProvider {
  return providers[provider]
}

export {
  ATTIO_REQUIRED_READ_SCOPES,
  ATTIO_WEBHOOK_SCOPE,
  type AttioCallRecording,
  type AttioTranscriptSegment,
  attioRequest,
  connectAttio,
  deleteAttioWebhook,
  fetchAttioCallRecording,
  formatAttioTranscript,
  getAttioAccessToken,
} from "./attio"
export { connectCloudwatch } from "./cloudwatch"
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
export {
  connectNotion,
  getNotionAccessToken,
  NOTION_API_VERSION,
  NOTION_REQUIRED_CAPABILITIES,
  notionCall,
} from "./notion"
export type { ConnectionRef, SourceProvider, SourceRef } from "./types"
