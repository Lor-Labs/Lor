import { randomBytes } from "node:crypto"

export const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
export const BASE62_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

const WORKSPACE_KEY_LENGTH = 10

// Rejection sampling: bytes past the largest multiple of the alphabet size
// are discarded so every character is equally likely (no modulo bias).
export function randomCode(length: number, alphabet = BASE36_ALPHABET): string {
  const limit = 256 - (256 % alphabet.length)
  let code = ""
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < limit && code.length < length) {
        code += alphabet.charAt(byte % alphabet.length)
      }
    }
  }
  return code
}

// Opaque workspace URL key, stored in workspace.slug.
export function workspaceKey(): string {
  return randomCode(WORKSPACE_KEY_LENGTH)
}
