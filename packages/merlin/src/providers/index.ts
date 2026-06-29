import type { schema } from "@repo/db"
import { githubProvider } from "./github"
import type { SourceProvider } from "./types"

type Provider = (typeof schema.integrationProviderEnum.enumValues)[number]

const providers: Partial<Record<Provider, SourceProvider>> = {
  github: githubProvider,
}

export function getSourceProvider(provider: Provider): SourceProvider | null {
  return providers[provider] ?? null
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
