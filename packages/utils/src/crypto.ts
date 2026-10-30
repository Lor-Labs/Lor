import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
// GCM accepts truncated tags unless the length is pinned.
const AUTH_TAG_BYTES = 16

// keyHex must be 64 hex chars (32 bytes / AES-256).
function toKey(keyHex: string): Buffer {
  return Buffer.from(keyHex, "hex")
}

// Encrypt a secret (e.g. an OAuth token) for storage at rest. A fresh random IV
// each call; output is base64(iv).base64(authTag).base64(ciphertext).
export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, toKey(keyHex), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".")
}

export function decryptSecret(stored: string, keyHex: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(".")
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed encrypted secret")
  }
  const tag = Buffer.from(tagB64, "base64")
  if (tag.length !== AUTH_TAG_BYTES) {
    throw new Error("Malformed encrypted secret")
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    toKey(keyHex),
    Buffer.from(ivB64, "base64"),
    { authTagLength: AUTH_TAG_BYTES }
  )
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
