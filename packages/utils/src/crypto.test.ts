import { describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret } from "./crypto"

const KEY = "a".repeat(64)
const OTHER_KEY = "b".repeat(64)

describe("crypto", () => {
  it("round-trips a secret", () => {
    const secret = "lin_oauth_abc123"
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY))
  })

  it("fails to decrypt with the wrong key", () => {
    expect(() => decryptSecret(encryptSecret("x", KEY), OTHER_KEY)).toThrow()
  })

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-valid", KEY)).toThrow(
      "Malformed encrypted secret"
    )
  })
})
