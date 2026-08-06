import { env } from "@repo/env/server"
import { logger } from "../logger"

const API_URL = "https://api.exa.ai"
const REQUEST_TIMEOUT_MS = 20_000
// Exa's maximum supported maxCharacters for page text.
const PAGE_TEXT_MAX = 10_000

export type ExaResult = {
  title?: string | null
  url: string
  publishedDate?: string | null
  author?: string | null
  text?: string
}

type ExaResponse = { results?: ExaResult[] }

async function exaRequest<T>(path: string, body: unknown): Promise<T | null> {
  const key = env.EXA_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "Exa API request failed")
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    logger.warn({ err, path }, "Exa API request error")
    return null
  }
}

export async function searchWeb(opts: {
  query: string
  numResults: number
  snippetCharacters: number
}): Promise<ExaResult[] | null> {
  const res = await exaRequest<ExaResponse>("/search", {
    query: opts.query,
    type: "auto",
    numResults: opts.numResults,
    contents: { text: { maxCharacters: opts.snippetCharacters } },
  })
  return res?.results ?? null
}

export async function fetchWebPage(url: string): Promise<ExaResult | null> {
  const res = await exaRequest<ExaResponse>("/contents", {
    urls: [url],
    text: { maxCharacters: PAGE_TEXT_MAX },
  })
  return res?.results?.[0] ?? null
}
