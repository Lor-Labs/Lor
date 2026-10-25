import { createHash } from "node:crypto"

// A person's Claude subscription for their own Claude Code turns
// (reference/planned/code-sessions-runbook.md chunk 7): the long-lived token
// `claude setup-token` prints, pasted once and stored encrypted. These tokens
// can run models but not read the account's profile, so the token itself is
// all that identifies the connection.

const TOKEN_PREFIX = "sk-ant-oat01-"
const VALID_FOR_DAYS = 365

// A terminal wraps the printed token over lines, so a paste may carry line
// breaks and spaces. Null when it is not a setup token (an API key, say).
export function normalizeClaudeToken(pasted: string): string | null {
  const token = pasted.replace(/\s+/g, "")
  return token.startsWith(TOKEN_PREFIX) &&
    token.length > TOKEN_PREFIX.length + 40 &&
    /^[A-Za-z0-9_-]+$/.test(token)
    ? token
    : null
}

export function claudeTokenDetails(token: string) {
  return {
    externalId: createHash("sha256").update(token).digest("hex").slice(0, 32),
    login: token.slice(-4),
    accessTokenExpiresAt: new Date(Date.now() + VALID_FOR_DAYS * 86_400_000),
  }
}

// Listing one model is free and needs a working token.
export async function verifyClaudeToken(
  token: string
): Promise<"ok" | "rejected" | "unreachable"> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return "unreachable"
  if (res.ok) return "ok"
  return res.status === 401 || res.status === 403 ? "rejected" : "unreachable"
}
