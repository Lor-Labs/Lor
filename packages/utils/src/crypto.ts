import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"

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
  const decipher = createDecipheriv(
    ALGORITHM,
    toKey(keyHex),
    Buffer.from(ivB64, "base64")
  )
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
