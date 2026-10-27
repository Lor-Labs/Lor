import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { checkServerIdentity, type PeerCertificate } from "node:tls"
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib"

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(address) !== 6) return false
  const [first = 0, second = 0] = address
    .split(":", 2)
    .map((part) => Number.parseInt(part || "0", 16))
  // Global unicast only; also exclude transition/documentation ranges.
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    !(first === 0x3fff && second <= 0xfff)
  )
}

export async function resolvePublicUrl(rawUrl: string | URL) {
  const url = new URL(rawUrl)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP(S) URLs without credentials are allowed")
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  // Loopback by name (RFC 6761), refused before any DNS lookup.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("The URL does not resolve to a public address")
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true })
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("The URL does not resolve to a public address")
  }
  return { url, address: addresses[0] as { address: string; family: number } }
}

// Node's transport works in Node and Bun; a vetted IP is pinned to this one
// connection while Host/SNI and certificate validation retain the original host.
export async function fetchPublicResource(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: { maxBytes: number; timeoutMs: number }
): Promise<Response> {
  const request = new Request(input, init)
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(options.timeoutMs),
  ])
  signal.throwIfAborted()
  const { url, address } = await new Promise<
    Awaited<ReturnType<typeof resolvePublicUrl>>
  >((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    resolvePublicUrl(request.url)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted))
  })
  signal.throwIfAborted()
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const destination = new URL(url)
  destination.hostname =
    address.family === 6 ? `[${address.address}]` : address.address
  const headers = Object.fromEntries(request.headers)
  headers.host = url.host
  headers["accept-encoding"] = "identity"
  const payload = request.body
    ? new Uint8Array(await request.arrayBuffer())
    : undefined
  if (payload && payload.byteLength > 8 * 1024 * 1024)
    throw new Error("Request body is too large")
  signal.throwIfAborted()
  return new Promise<Response>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      destination,
      {
        method: request.method,
        headers,
        agent: false,
        family: address.family,
        ...(url.protocol === "https:"
          ? {
              servername: isIP(hostname) ? "" : hostname,
              rejectUnauthorized: true,
              checkServerIdentity: (
                _host: string,
                certificate: PeerCertificate
              ) => checkServerIdentity(hostname, certificate),
            }
          : {}),
        signal,
      },
      (res) => {
        try {
          const status = res.statusCode ?? 502
          const responseHeaders = new Headers()
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            const name = res.rawHeaders[i]
            const value = res.rawHeaders[i + 1]
            if (name && value !== undefined) responseHeaders.append(name, value)
          }
          const respond = (body: ReadableStream<Uint8Array> | null) => {
            const response = new Response(body, {
              status,
              headers: responseHeaders,
            })
            Object.defineProperty(response, "url", { value: url.toString() })
            resolve(response)
          }
          const encoding = responseHeaders
            .get("content-encoding")
            ?.toLowerCase()
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null
          if (encoding && encoding !== "identity" && !decoder) {
            res.destroy()
            reject(new Error("Unsupported response encoding"))
            return
          }
          const declared = Number(responseHeaders.get("content-length"))
          if (
            !decoder &&
            Number.isFinite(declared) &&
            declared > options.maxBytes
          ) {
            res.destroy()
            reject(new Error("Response exceeds the download limit"))
            return
          }
          if (request.method === "HEAD" || [204, 205, 304].includes(status)) {
            res.resume()
            respond(null)
            return
          }
          if (decoder) {
            responseHeaders.delete("content-encoding")
            responseHeaders.delete("content-length")
            res.once("error", (error) => decoder.destroy(error))
          }
          const stream = decoder ? res.pipe(decoder) : res
          const iterator = stream[Symbol.asyncIterator]()
          let received = 0
          const close = () => {
            stream.destroy()
            res.destroy()
            req.destroy()
          }
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const { done, value } = await iterator.next()
                if (done) {
                  controller.close()
                  close()
                  return
                }
                const bytes =
                  value instanceof Uint8Array ? value : Buffer.from(value)
                received += bytes.byteLength
                if (received > options.maxBytes)
                  throw new Error("Response exceeds the download limit")
                controller.enqueue(bytes)
              } catch (error) {
                close()
                controller.error(error)
              }
            },
            cancel: close,
          })
          respond(body)
        } catch (error) {
          res.destroy()
          req.destroy()
          reject(error)
        }
      }
    )
    req.once("error", reject)
    req.end(payload)
  })
}
