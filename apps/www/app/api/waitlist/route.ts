const UPSTREAM_TIMEOUT_MS = 8_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNAVAILABLE_MESSAGE =
  "Early access signup is temporarily unavailable. Please try again later."

function getWaitlistUrl() {
  // Avoid requiring backend secrets or realtime config just to join the waitlist.
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (!configuredUrl) return null

  try {
    const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(configuredUrl)
    const url = new URL(
      hasProtocol ? configuredUrl : `https://${configuredUrl}`
    )
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    if (
      !hasProtocol &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      url.protocol = "http:"
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/waitlist`
    return url
  } catch {
    return null
  }
}

function errorResponse(
  error: string,
  status: number,
  retryAfter?: string | null
) {
  const headers = new Headers({ "Cache-Control": "no-store" })
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) {
    headers.set("Retry-After", retryAfter)
  }
  return Response.json({ error }, { status, headers })
}

export async function POST(request: Request) {
  const url = getWaitlistUrl()
  if (!url) return errorResponse(UNAVAILABLE_MESSAGE, 503)

  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return errorResponse("Send an email address as JSON.", 415)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse("Send a valid JSON request.", 400)
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("email" in body) ||
    typeof body.email !== "string"
  ) {
    return errorResponse("A valid email address is required.", 400)
  }
  const email = body.email.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("A valid email address is required.", 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    })

    if (response.status === 200) {
      const result: unknown = await response.json()
      if (
        result &&
        typeof result === "object" &&
        "success" in result &&
        result.success === true
      ) {
        return Response.json(
          { success: true },
          { headers: { "Cache-Control": "no-store" } }
        )
      }
      return errorResponse(UNAVAILABLE_MESSAGE, 502)
    }

    await response.body?.cancel().catch(() => undefined)
    if (response.status === 400) {
      return errorResponse("A valid email address is required.", 400)
    }
    if (response.status === 409) {
      return errorResponse("This email is already on the waitlist.", 409)
    }
    if (response.status === 429) {
      return errorResponse(
        "Too many requests. Please wait a minute and try again.",
        429,
        response.headers.get("retry-after")
      )
    }
    return errorResponse(
      UNAVAILABLE_MESSAGE,
      response.status >= 500 ? response.status : 502
    )
  } catch {
    return errorResponse(
      controller.signal.aborted
        ? "The request timed out. Please try again."
        : UNAVAILABLE_MESSAGE,
      controller.signal.aborted ? 504 : 502
    )
  } finally {
    clearTimeout(timeout)
  }
}
