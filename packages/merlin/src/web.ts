import { tool } from "ai"
import { z } from "zod"
import { fetchWebPage, searchWeb } from "./providers/exa"

const SEARCH_DEFAULT = 5
const SEARCH_MAX = 10
const SNIPPET_CHARS = 1_500

export const webTools = {
  search_web: tool({
    description:
      "Search the public web for current information — documentation, articles, releases, anything outside this team's workspace and connected tools. Returns results with a title, url, published date, and a text snippet. For a page's full content, call fetch_web with its url. Reference a result with a normal Markdown link to its url (live results, not [[src:]] citations).",
    inputSchema: z.object({
      query: z.string().describe("a natural-language search query"),
      limit: z.number().optional().describe("max results, 1–10 (default 5)"),
    }),
    execute: async ({ query, limit }) => {
      const n = Math.floor(
        Math.min(Math.max(limit ?? SEARCH_DEFAULT, 1), SEARCH_MAX)
      )
      const results = await searchWeb({
        query,
        numResults: n,
        snippetCharacters: SNIPPET_CHARS,
      })
      if (!results) return { error: "web search failed" }
      return {
        results: results.map((r) => ({
          title: r.title ?? undefined,
          url: r.url,
          publishedDate: r.publishedDate ?? undefined,
          snippet: r.text,
        })),
      }
    },
    strict: true,
  }),
  fetch_web: tool({
    description:
      "Fetch a public web page's content as text — a url from search_web results or one shared in the conversation. Reference it with a normal Markdown link to its url.",
    inputSchema: z.object({
      url: z.string().describe("the page url to fetch"),
    }),
    execute: async ({ url }) => {
      const page = await fetchWebPage(url)
      if (!page?.text) return { error: "couldn't fetch that page" }
      return {
        title: page.title ?? undefined,
        url: page.url,
        publishedDate: page.publishedDate ?? undefined,
        text: page.text,
      }
    },
    strict: true,
  }),
}
