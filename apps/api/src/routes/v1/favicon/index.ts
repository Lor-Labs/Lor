import { createRouter } from "@/lib/helpers/app/create-app"

// Favicon proxy for message-link icons: the client asks us, we ask DuckDuckGo,
// so third parties never see which hostnames users' clients render. Plain
// (non-OpenAPI) route — consumed via <img src>, not the typed client.
const HOSTNAME_REGEX =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const UPSTREAM_TIMEOUT_MS = 5_000
// A domain's favicon changes rarely; let browsers and the CDN hold it a while.
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800"
// Raster formats only — never svg or other active content, since a response
// opened top-level would render on this (cookie-bearing) origin.
const ALLOWED_TYPES = new Set([
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/ico",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
])

const faviconRouter = createRouter().get("/favicon/:domain", async (c) => {
  const domain = c.req.param("domain").toLowerCase()
  if (domain.length > 253 || !HOSTNAME_REGEX.test(domain)) {
    return c.body(null, 400)
  }
  try {
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase()
    if (
      !res.ok ||
      !res.body ||
      !contentType ||
      !ALLOWED_TYPES.has(contentType)
    ) {
      return c.body(null, 404)
    }
    return c.body(res.body, 200, {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    })
  } catch {
    return c.body(null, 404)
  }
})

export default faviconRouter
