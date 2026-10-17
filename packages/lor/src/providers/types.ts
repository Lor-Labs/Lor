import type { schema } from "@repo/db"
import type { SourceItem } from "../sources"

export type ConnectionRef = Pick<
  typeof schema.integrationConnection.$inferSelect,
  "externalId"
>

export interface SourceProvider {
  verifyConnection(
    connection: ConnectionRef
  ): Promise<{ accountLabel: string | null } | null>
}

// One refetch for ingestion. `gone` lists stored keys to tombstone: the item
// was deleted, or moved to a new key (a transferred issue, a renamed repo).
// Transient failures throw, so the job retries.
export type SourceFetch = { item: SourceItem | null; gone: string[] }

export type SourceFetcher = (
  connection: ConnectionRef,
  kind: string,
  ref: string
) => Promise<SourceFetch>
