import { describe, expect, it } from "vitest"
import {
  bodyMustBeJson,
  bodyTemplateJsonIssue,
  buildCustomToolRequest,
  CUSTOM_TOOL_NAME_REGEX,
  customToolUrlIssue,
  RESERVED_TOOL_NAMES,
  renderTemplate,
} from "./custom-tools"

describe("customToolUrlIssue", () => {
  it("accepts a normal https URL", () => {
    expect(customToolUrlIssue("https://api.acme.com/v1/orders")).toBeNull()
  })

  it("rejects http", () => {
    expect(customToolUrlIssue("http://api.acme.com")).toMatch(/https/)
  })

  it("rejects garbage", () => {
    expect(customToolUrlIssue("not a url")).toMatch(/not valid/)
  })

  it("rejects inline credentials", () => {
    expect(customToolUrlIssue("https://user:pw@api.acme.com")).toMatch(
      /headers or secrets/
    )
  })

  it("rejects IPv4 and IPv6 literals", () => {
    expect(customToolUrlIssue("https://10.0.0.1/x")).toMatch(/IP literals/)
    expect(customToolUrlIssue("https://169.254.169.254/meta")).toMatch(
      /IP literals/
    )
    expect(customToolUrlIssue("https://[::1]/x")).toMatch(/IPv6/)
  })

  it("rejects internal hostnames", () => {
    expect(customToolUrlIssue("https://localhost/x")).toMatch(/Internal/)
    expect(customToolUrlIssue("https://db.local/x")).toMatch(/Internal/)
    expect(customToolUrlIssue("https://vault.internal/x")).toMatch(/Internal/)
    expect(customToolUrlIssue("https://api.localhost/x")).toMatch(/Internal/)
    expect(customToolUrlIssue("https://nas.home.arpa/x")).toMatch(/Internal/)
  })

  it("rejects dotless intranet names", () => {
    expect(customToolUrlIssue("https://intranet/x")).toMatch(/public domain/)
  })

  it("rejects templates whose host is a placeholder", () => {
    // {{...}} in the host makes URL parsing fail or produces a dotless host.
    expect(customToolUrlIssue("https://{{args.host}}/x")).not.toBeNull()
  })
})

describe("renderTemplate", () => {
  const args = { id: "or_1 2", limit: 5, filter: { a: 1 } }
  const secrets = { API_KEY: "s3cret" }

  it("percent-encodes args in URLs", () => {
    expect(
      renderTemplate(
        "https://api.acme.com/orders/{{args.id}}?limit={{args.limit}}",
        "url",
        args,
        secrets
      )
    ).toBe("https://api.acme.com/orders/or_1%202?limit=5")
  })

  it("substitutes JSON encodings in bodies", () => {
    expect(
      renderTemplate(
        '{"id": {{args.id}}, "limit": {{args.limit}}, "filter": {{args.filter}}}',
        "body",
        args,
        secrets
      )
    ).toBe('{"id": "or_1 2", "limit": 5, "filter": {"a":1}}')
  })

  it("substitutes raw values in headers", () => {
    expect(
      renderTemplate("Bearer {{secrets.API_KEY}}", "header", args, secrets)
    ).toBe("Bearer s3cret")
  })

  it("tolerates whitespace inside placeholders", () => {
    expect(renderTemplate("x={{ args.limit }}", "header", args, secrets)).toBe(
      "x=5"
    )
  })

  it("throws on unknown references", () => {
    expect(() =>
      renderTemplate("{{args.nope}}", "header", args, secrets)
    ).toThrow(/unknown args.nope/)
    expect(() =>
      renderTemplate("{{secrets.NOPE}}", "header", args, secrets)
    ).toThrow(/unknown secrets.NOPE/)
  })
})

describe("buildCustomToolRequest", () => {
  const base = {
    name: "get_order",
    method: "GET" as const,
    urlTemplate: "https://api.acme.com/orders/{{args.id}}",
    headers: { Authorization: "Bearer {{secrets.KEY}}" },
    bodyTemplate: null,
  }

  it("assembles a GET with no body", () => {
    const req = buildCustomToolRequest(base, { id: "42" }, { KEY: "k" })
    expect(req).toEqual({
      url: "https://api.acme.com/orders/42",
      method: "GET",
      headers: { Authorization: "Bearer k" },
      body: null,
    })
  })

  it("defaults POST bodies to all args as JSON, with content-type", () => {
    const req = buildCustomToolRequest(
      { ...base, method: "POST", urlTemplate: "https://api.acme.com/orders" },
      { id: "42", note: "hi" },
      { KEY: "k" }
    )
    expect(req.body).toBe('{"id":"42","note":"hi"}')
    expect(req.headers["Content-Type"]).toBe("application/json")
  })

  it("uses the body template when present and keeps a user content-type", () => {
    const req = buildCustomToolRequest(
      {
        ...base,
        method: "POST",
        urlTemplate: "https://api.acme.com/graphql",
        headers: { "content-type": "application/graphql+json" },
        bodyTemplate: '{"query": {{args.query}}}',
      },
      { query: "{ orders { id } }" },
      {}
    )
    expect(req.body).toBe('{"query": "{ orders { id } }"}')
    expect(req.headers["content-type"]).toBe("application/graphql+json")
    expect(req.headers["Content-Type"]).toBeUndefined()
  })

  it("re-validates the URL after interpolation", () => {
    expect(() =>
      buildCustomToolRequest(
        { ...base, urlTemplate: "https://{{args.host}}/x" },
        { host: "localhost" },
        {}
      )
    ).toThrow()
  })
})

describe("body JSON contract", () => {
  it("requires JSON when the content type is absent or json-ish", () => {
    expect(bodyMustBeJson({})).toBe(true)
    expect(bodyMustBeJson({ "Content-Type": "application/json" })).toBe(true)
    expect(
      bodyMustBeJson({ "content-type": "application/x-www-form-urlencoded" })
    ).toBe(false)
    expect(bodyMustBeJson({ "Content-Type": "application/graphql" })).toBe(
      false
    )
  })

  it("lints templates with placeholders treated as values", () => {
    expect(bodyTemplateJsonIssue('{"q": {{args.q}}}')).toBeNull()
    expect(bodyTemplateJsonIssue('{"q": {{args.q}},}')).toBeTruthy()
    expect(bodyTemplateJsonIssue("a=1&b=2")).toBeTruthy()
  })
})

describe("name rules", () => {
  it("accepts snake_case identifiers", () => {
    expect(CUSTOM_TOOL_NAME_REGEX.test("query_orders")).toBe(true)
  })

  it("rejects bad names", () => {
    for (const bad of ["Q", "1tool", "has-dash", "Has_Caps", "ab"]) {
      expect(CUSTOM_TOOL_NAME_REGEX.test(bad)).toBe(false)
    }
  })

  it("reserves built-in names", () => {
    expect(RESERVED_TOOL_NAMES.has("search")).toBe(true)
    expect(RESERVED_TOOL_NAMES.has("create_plan")).toBe(true)
  })
})
