import { describe, expect, it } from "vitest"
import { extractCurlSecrets, parseCurl } from "./parse-curl"

describe("parseCurl", () => {
  it("parses a docs-style POST with headers and JSON body", () => {
    const parsed = parseCurl(
      `curl -X POST 'https://api.acme.com/v1/orders' \\
  -H 'Authorization: Bearer sk_123' \\
  -H "Content-Type: application/json" \\
  -d '{"customer": "cus_1", "amount": 100}'`
    )
    expect(parsed).toEqual({
      method: "POST",
      url: "https://api.acme.com/v1/orders",
      headers: {
        Authorization: "Bearer sk_123",
        "Content-Type": "application/json",
      },
      body: '{"customer": "cus_1", "amount": 100}',
    })
  })

  it("defaults to GET without data and POST with data", () => {
    expect(parseCurl("curl https://api.acme.com/x")?.method).toBe("GET")
    expect(parseCurl("curl https://api.acme.com/x -d 'a=1'")?.method).toBe(
      "POST"
    )
  })

  it("percent-encodes --data-urlencode values per curl's forms", () => {
    const parsed = parseCurl(
      `curl https://api.acme.com/x --data-urlencode 'q=hello world' --data-urlencode '=a&b' --data-urlencode 'plain val'`
    )
    expect(parsed?.body).toBe("q=hello%20world&a%26b&plain%20val")
    expect(parsed?.method).toBe("POST")
  })

  it("skips file-backed --data-urlencode forms without eating the URL", () => {
    const parsed = parseCurl(
      "curl --data-urlencode @body.txt --data-urlencode name@file.txt https://api.acme.com/x"
    )
    expect(parsed?.url).toBe("https://api.acme.com/x")
    expect(parsed?.body).toBeNull()
  })

  it("consumes form and upload flag values instead of treating them as the URL", () => {
    const parsed = parseCurl(
      "curl -F file=@photo.png -T upload.bin https://api.acme.com/x"
    )
    expect(parsed?.url).toBe("https://api.acme.com/x")
    expect(parsed?.body).toBeNull()
  })

  it("encodes non-Latin1 basic auth credentials without throwing", () => {
    const parsed = parseCurl("curl -u 'user:pässwörd❤' https://api.acme.com/x")
    expect(parsed?.headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/)
  })

  it("handles --request, --url, --json and basic auth", () => {
    const parsed = parseCurl(
      `curl --request PUT --url https://api.acme.com/y --json '{"a":1}' -u user:pass`
    )
    expect(parsed?.method).toBe("PUT")
    expect(parsed?.url).toBe("https://api.acme.com/y")
    expect(parsed?.headers["Content-Type"]).toBe("application/json")
    expect(parsed?.headers.Authorization).toBe(`Basic ${btoa("user:pass")}`)
    expect(parsed?.body).toBe('{"a":1}')
  })

  it("ignores transfer flags and value flags", () => {
    const parsed = parseCurl(
      "curl -sL --compressed -o out.json -A agent https://api.acme.com/z"
    )
    expect(parsed?.url).toBe("https://api.acme.com/z")
    expect(parsed?.headers).toEqual({})
  })

  it("prepends https when the scheme is missing", () => {
    expect(parseCurl("curl api.acme.com/v1/things")?.url).toBe(
      "https://api.acme.com/v1/things"
    )
  })

  it("handles escaped double quotes in bodies", () => {
    const parsed = parseCurl(
      'curl -d "{\\"q\\": \\"test\\"}" https://api.acme.com/search'
    )
    expect(parsed?.body).toBe('{"q": "test"}')
  })

  it("returns null without a URL", () => {
    expect(parseCurl("curl -X POST")).toBeNull()
    expect(parseCurl("")).toBeNull()
  })

  it("skips @file bodies", () => {
    expect(
      parseCurl("curl -d @payload.json https://api.acme.com/x")?.body
    ).toBeNull()
  })
})

describe("extractCurlSecrets", () => {
  it("extracts bearer tokens with the scheme kept in the template", () => {
    expect(
      extractCurlSecrets({ Authorization: "Bearer abc123xyz4567890" })
    ).toEqual({
      headers: { Authorization: "Bearer {{secrets.BEARER_TOKEN}}" },
      secrets: [{ name: "BEARER_TOKEN", value: "abc123xyz4567890" }],
    })
  })

  it("extracts basic auth", () => {
    const result = extractCurlSecrets({ Authorization: "Basic dXNlcjpwYXNz" })
    expect(result.headers.Authorization).toBe("Basic {{secrets.BASIC_AUTH}}")
    expect(result.secrets).toEqual([
      { name: "BASIC_AUTH", value: "dXNlcjpwYXNz" },
    ])
  })

  it("extracts credential-named headers and derives names", () => {
    const result = extractCurlSecrets({
      "X-Api-Key": "sk_live_12345678",
      "Content-Type": "application/json",
    })
    expect(result.headers).toEqual({
      "X-Api-Key": "{{secrets.API_KEY}}",
      "Content-Type": "application/json",
    })
    expect(result.secrets).toEqual([
      { name: "API_KEY", value: "sk_live_12345678" },
    ])
  })

  it("leaves short values and existing references alone", () => {
    const result = extractCurlSecrets({
      "X-Api-Key": "short",
      "X-Auth-Token": "{{secrets.ALREADY}}",
    })
    expect(result.headers).toEqual({
      "X-Api-Key": "short",
      "X-Auth-Token": "{{secrets.ALREADY}}",
    })
    expect(result.secrets).toEqual([])
  })

  it("dedupes derived names", () => {
    const result = extractCurlSecrets({
      "X-Api-Key": "sk_live_12345678",
      "Api-Key": "sk_test_12345678",
    })
    expect(result.secrets.map((s) => s.name)).toEqual(["API_KEY", "API_KEY_2"])
  })
})
