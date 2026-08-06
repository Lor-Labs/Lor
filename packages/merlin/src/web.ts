import { tool } from "ai"
import { z } from "zod"
import { fetchWebPage, searchWeb } from "./providers/exa"

const SEARCH_DEFAULT = 5
const SEARCH_MAX = 10

export const webTools = {
  search_web: tool({
    description:
      "Search the public web for current information — documentation, articles, releases, anything outside this team's workspace and connected tools. Returns results with a title, url, published date, and highlight excerpts relevant to the query. For a page's full content, call fetch_web with its url. Reference a result with a normal Markdown link to its url (live results, not [[src:]] citations).",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "a natural-language query — longer, semantically rich descriptions work well"
        ),
      limit: z.number().optional().describe("max results, 1–10 (default 5)"),
      category: z
        .enum([
          "company",
          "publication",
          "news",
          "personal site",
          "financial report",
          "people",
        ])
        .optional()
        .describe(
          "focus on one content kind, e.g. news for current events or publication for research papers"
        ),
      includeDomains: z
        .array(z.string())
        .optional()
        .describe(
          "only results from these domains; accepts path prefixes (exa.ai/blog) and wildcards (*.substack.com)"
        ),
      excludeDomains: z
        .array(z.string())
        .optional()
        .describe(
          "exclude these domains (not supported with category company/people)"
        ),
      startPublishedDate: z
        .string()
        .optional()
        .describe(
          "ISO 8601 — only pages published after this date (not supported with category company/people)"
        ),
      endPublishedDate: z
        .string()
        .optional()
        .describe("ISO 8601 — only pages published before this date"),
    }),
    execute: async ({ query, limit, ...filters }) => {
      const n = Math.floor(
        Math.min(Math.max(limit ?? SEARCH_DEFAULT, 1), SEARCH_MAX)
      )
      const res = await searchWeb(query, { numResults: n, ...filters })
      if ("error" in res) return res
      return {
        results: res.results.map((r) => ({
          title: r.title ?? undefined,
          url: r.url,
          publishedDate: r.publishedDate,
          author: r.author,
          favicon: r.favicon,
          highlights: r.highlights,
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
      const res = await fetchWebPage(url)
      if ("error" in res) return res
      const page = res.page
      if (!page?.text) return { error: "couldn't fetch that page" }
      return {
        title: page.title ?? undefined,
        url: page.url,
        publishedDate: page.publishedDate,
        favicon: page.favicon,
        // Delimited so the model treats page text as untrusted reference
        // material, per the web prompt line.
        text: `<untrusted_web_content>\n${page.text}\n</untrusted_web_content>`,
      }
    },
    strict: true,
  }),
}
