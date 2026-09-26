import { schema, sql } from "@repo/db"

// How a person appears everywhere in the app (message author header, mention
// pill, composer): their real name. Lor reads and mentions people by this same
// label so its prose and pills stay consistent — and it matches the identity
// external apps (Linear, GitHub) know them by.
export function userDisplayName(u: { name: string }): string {
  return u.name
}

// websearch_to_tsquery ANDs its terms, so a natural-language query returns
// nothing unless a single row contains every content word. Rewrite the AND
// (&) operators to OR (|) so it degrades gracefully — a row matching some
// terms still surfaces, ranked below fuller matches by ts_rank. The websearch
// parser still handles stopword removal, stemming, and sanitizing the raw
// user text for us.
export function orTsQuery(query: string) {
  return sql`replace(websearch_to_tsquery('english', ${query})::text, '&', '|')::tsquery`
}

// Effective audience lives on the access container (parent category or the
// channel itself); mirror of the shared resolver's rule, in SQL. A scalar
// subquery keeps drizzle happy where a self-alias join breaks its typing.
export function privateAudienceFilter(
  privateContainerChannelId: string | null
) {
  const effectiveAudience = sql`coalesce((select p."audience" from "channel" p where p."id" = ${schema.channel.parentId}), ${schema.channel.audience})`
  const containerId = sql`coalesce(${schema.channel.parentId}, ${schema.channel.id})`
  return privateContainerChannelId
    ? sql`(${effectiveAudience} = 'workspace' or ${containerId} = ${privateContainerChannelId}::uuid)`
    : sql`${effectiveAudience} = 'workspace'`
}
