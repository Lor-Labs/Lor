import { describe, expect, it } from "vitest"
import { ATTIO_REQUIRED_READ_SCOPES, validateAttioReadScopes } from "./attio"

describe("validateAttioReadScopes", () => {
  const complete = ATTIO_REQUIRED_READ_SCOPES.join(" ")

  it("accepts the complete read-only scope set", () => {
    expect(validateAttioReadScopes(complete)).toBe(true)
  })

  it("rejects a connection missing an activity read scope", () => {
    expect(
      validateAttioReadScopes(
        ATTIO_REQUIRED_READ_SCOPES.filter(
          (scope) => scope !== "call_recording:read"
        ).join(" ")
      )
    ).toBe(false)
  })

  it("rejects any read-write scope even when every read scope is present", () => {
    expect(
      validateAttioReadScopes(`${complete} record_permission:read-write`)
    ).toBe(false)
  })
})
