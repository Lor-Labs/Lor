import type { schema } from "@repo/db"

export type SourceRef = Pick<
  typeof schema.source.$inferSelect,
  "kind" | "externalId" | "url"
>
export type ConnectionRef = Pick<
  typeof schema.integrationConnection.$inferSelect,
  "externalId"
>

export interface SourceProvider {
  fetchContent(
    source: SourceRef,
    connection: ConnectionRef
  ): Promise<string | null>

  verifyConnection(
    connection: ConnectionRef
  ): Promise<{ accountLabel: string | null } | null>
}
