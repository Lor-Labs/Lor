import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

export class McpNetworkPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpNetworkPolicyError"
  }
}

type AddressResolver = (
  hostname: string
) => Promise<readonly { address: string }[]>

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type GuardedMcpFetch = FetchLike & {
  validateUrl: (url: string | URL) => Promise<URL>
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".")
  if (parts.length !== 4) return null
  const parsed = parts.map(Number)
  return parsed.every(
    (part) => Number.isInteger(part) && part >= 0 && part <= 255
  )
    ? parsed
    : null
}

function normalizedAddress(address: string): string {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "")
  const decimal = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (decimal?.[1]) return decimal[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value)
  if (!(hex?.[1] && hex[2])) return value
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

export function isBlockedMcpAddress(rawAddress: string): boolean {
  const address = normalizedAddress(rawAddress)
  const v4 = ipv4Parts(address)
  if (v4) {
    const [a = 0, b = 0, c = 0] = v4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }

  const v6 = address.toLowerCase()
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    /^ff/.test(v6) ||
    /^2001:db8(?::|$)/.test(v6)
  )
}

function parseAndCheckUrl(rawUrl: string | URL, production: boolean): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new McpNetworkPolicyError("Endpoint URL is invalid")
  }
  if (url.username || url.password) {
    throw new McpNetworkPolicyError("Endpoint URL cannot contain credentials")
  }
  if (
    production ? url.protocol !== "https:" : !/^https?:$/.test(url.protocol)
  ) {
    throw new McpNetworkPolicyError(
      production
        ? "Endpoint URL must use HTTPS"
        : "Endpoint URL must use HTTP or HTTPS"
    )
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isIP(hostname) !== 0
  ) {
    throw new McpNetworkPolicyError(
      "Endpoint hostname is not publicly routable"
    )
  }
  return url
}

function limitedResponse(response: Response, maxBytes: number): Response {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel()
    throw new McpNetworkPolicyError("Endpoint response is too large")
  }
  if (!response.body) return response

  const reader = response.body.getReader()
  let received = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
          return
        }
        received += chunk.value.byteLength
        if (received > maxBytes) {
          await reader.cancel()
          controller.error(
            new McpNetworkPolicyError("Endpoint response is too large")
          )
          return
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  const limited = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  Object.defineProperties(limited, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  })
  return limited
}

export function createGuardedMcpFetch(options: {
  resourceUrl: string | URL
  sensitiveHeaderNames?: readonly string[]
  production?: boolean
  timeoutMs?: number
  maxResponseBytes?: number
  resolveAddresses?: AddressResolver
  fetchImpl?: FetchLike
}): GuardedMcpFetch {
  const production = options.production ?? process.env.NODE_ENV === "production"
  const resourceUrl = parseAndCheckUrl(options.resourceUrl, production)
  const resourceOrigin = resourceUrl.origin
  const sensitiveHeaders = new Set(
    (options.sensitiveHeaderNames ?? []).map((name) => name.toLowerCase())
  )
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const resolveAddresses: AddressResolver =
    options.resolveAddresses ??
    (async (hostname) => await lookup(hostname, { all: true }))
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const validateUrl = async (rawUrl: string | URL): Promise<URL> => {
    const url = parseAndCheckUrl(rawUrl, production)
    let addresses: readonly { address: string }[]
    try {
      addresses = await resolveAddresses(url.hostname)
    } catch {
      throw new McpNetworkPolicyError("Endpoint hostname did not resolve")
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isBlockedMcpAddress(address))
    ) {
      throw new McpNetworkPolicyError(
        "Endpoint hostname does not resolve to a public address"
      )
    }
    return url
  }

  const guardedFetch: FetchLike = async (input, init) => {
    const request = new Request(input, init)
    const url = await validateUrl(request.url)
    const authorization = request.headers.get("authorization")
    if (
      authorization?.toLowerCase().startsWith("bearer ") &&
      url.origin !== resourceOrigin
    ) {
      throw new McpNetworkPolicyError(
        "OAuth bearer credentials cannot cross origins"
      )
    }
    if (
      url.origin !== resourceOrigin &&
      [...sensitiveHeaders].some((name) => request.headers.has(name))
    ) {
      throw new McpNetworkPolicyError("MCP server headers cannot cross origins")
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal
    const response = await fetchImpl(
      new Request(request, { redirect: "manual", signal })
    )
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel()
      throw new McpNetworkPolicyError("Endpoint redirects are not allowed")
    }
    return limitedResponse(response, maxResponseBytes)
  }

  return Object.assign(guardedFetch, { validateUrl })
}
