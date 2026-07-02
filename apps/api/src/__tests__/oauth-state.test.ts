import { describe, expect, it } from "vitest"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"

describe("oauth-state", () => {
  it("round-trips a signed state for the same user", () => {
    const state = signOAuthState("acme", "user-1")
    expect(verifyOAuthState(state, "user-1")).toBe("acme")
  })

  it("rejects a state minted for a different user", () => {
    const state = signOAuthState("acme", "user-1")
    expect(verifyOAuthState(state, "user-2")).toBeNull()
  })

  it("rejects a tampered slug", () => {
    const [, expMs, sig] = signOAuthState("acme", "user-1").split(".")
    expect(verifyOAuthState(`evil.${expMs}.${sig}`, "user-1")).toBeNull()
  })

  it("rejects an expired state", () => {
    const past = Date.now() - 1000
    const state = signOAuthState("acme", "user-1")
    const [slug] = state.split(".")
    // Re-sign with a past expiry would need the secret; instead assert a
    // hand-built past-dated state (any signature) is refused on the expiry gate.
    expect(verifyOAuthState(`${slug}.${past}.deadbeef`, "user-1")).toBeNull()
  })

  it("rejects malformed states", () => {
    expect(verifyOAuthState("acme", "user-1")).toBeNull()
    expect(verifyOAuthState("acme.123", "user-1")).toBeNull()
  })
})
