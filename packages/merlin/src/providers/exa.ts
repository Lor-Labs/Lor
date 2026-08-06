import { env } from "@repo/env/server"
import Exa, {
  type BaseSearchOptions,
  ExaError,
  type SearchResult,
} from "exa-js"
import { logger } from "../logger"

// Exa's maximum supported maxCharacters for page text.
const PAGE_TEXT_MAX = 10_000

// Highlights over text for search: the most relevant excerpts per result at a
// fraction of the tokens (Exa's recommended mode for agent loops).
const SEARCH_CONTENTS = { highlights: true } as const
const FETCH_CONTENTS = { text: { maxCharacters: PAGE_TEXT_MAX } } as const

export type WebSearchResult = SearchResult<typeof SEARCH_CONTENTS>
export type WebPageResult = SearchResult<typeof FETCH_CONTENTS>

export type WebSearchOptions = {
  numResults: number
  category?: BaseSearchOptions["category"]
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
}

let client: Exa | null = null
function exa(): Exa | null {
  if (!env.EXA_API_KEY) return null
  client ??= new Exa(env.EXA_API_KEY)
  return client
}

// Surface the API's own message (e.g. "excludeDomains is not supported with
// category company") so the model can correct its next call.
function failure(err: unknown, op: string): { error: string } {
  logger.warn({ err, op }, "Exa request failed")
  return { error: err instanceof ExaError ? err.message : `${op} failed` }
}

export async function searchWeb(
  query: string,
  opts: WebSearchOptions
): Promise<{ results: WebSearchResult[] } | { error: string }> {
  const api = exa()
  if (!api) return { error: "web search isn't configured" }
  try {
    const res = await api.search(query, {
      type: "auto",
      numResults: opts.numResults,
      category: opts.category,
      includeDomains: opts.includeDomains,
      excludeDomains: opts.excludeDomains,
      startPublishedDate: opts.startPublishedDate,
      endPublishedDate: opts.endPublishedDate,
      contents: SEARCH_CONTENTS,
    })
    return { results: res.results }
  } catch (err) {
    return failure(err, "web search")
  }
}

export async function fetchWebPage(
  url: string
): Promise<{ page: WebPageResult | undefined } | { error: string }> {
  const api = exa()
  if (!api) return { error: "web fetch isn't configured" }
  try {
    const res = await api.getContents(url, FETCH_CONTENTS)
    return { page: res.results[0] }
  } catch (err) {
    return failure(err, "web fetch")
  }
}
