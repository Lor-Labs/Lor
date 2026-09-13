import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type {
  McpServerAuthMode,
  McpServerOAuthAttempt,
  McpServerOAuthStatus,
} from "@repo/db/schema"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { z } from "zod"

export const MCP_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000

const safeUrlSchema = z.string().url()

const oauthTokensSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  token_type: z.string().min(1),
  expires_in: z.number().nonnegative().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  authorization_server: safeUrlSchema.optional(),
  token_endpoint: safeUrlSchema.optional(),
})

const oauthClientInformationSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  client_id_issued_at: z.number().optional(),
  client_secret_expires_at: z.number().optional(),
  authorization_server: safeUrlSchema.optional(),
  token_endpoint: safeUrlSchema.optional(),
})

const oauthAuthorizationServerInformationSchema = z.object({
  authorizationServerUrl: safeUrlSchema,
  tokenEndpoint: safeUrlSchema,
})

export const mcpOAuthCredentialEnvelopeSchema = z
  .object({
    version: z.literal(1),
    tokens: oauthTokensSchema.optional(),
    clientInformation: oauthClientInformationSchema.optional(),
    authorizationServerInformation:
      oauthAuthorizationServerInformationSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.tokens !== undefined ||
      value.clientInformation !== undefined ||
      value.authorizationServerInformation !== undefined,
    { message: "OAuth credential envelope is empty" }
  )

export type McpOAuthCredentialEnvelope = z.infer<
  typeof mcpOAuthCredentialEnvelopeSchema
>

export function encryptMcpOAuthCredentials(
  credentials: McpOAuthCredentialEnvelope,
  key: string
): string {
  const validated = mcpOAuthCredentialEnvelopeSchema.parse(credentials)
  return encryptSecret(JSON.stringify(validated), key)
}

export function decryptMcpOAuthCredentials(
  ciphertext: string,
  key: string
): McpOAuthCredentialEnvelope {
  try {
    return mcpOAuthCredentialEnvelopeSchema.parse(
      JSON.parse(decryptSecret(ciphertext, key))
    )
  } catch (error) {
    throw new Error("Malformed MCP OAuth credential envelope", { cause: error })
  }
}

export function createMcpOAuthState(): string {
  return randomBytes(32).toString("base64url")
}

export function hashMcpOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex")
}

export function mcpOAuthAttemptExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + MCP_OAUTH_ATTEMPT_TTL_MS)
}

type OAuthAttemptSnapshot = Pick<
  McpServerOAuthAttempt,
  "stateHash" | "expiresAt" | "consumedAt"
>

export type McpOAuthAttemptValidation =
  | { ok: true }
  | { ok: false; reason: "consumed" | "expired" | "state_mismatch" }

function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex")
  const right = Buffer.from(rightHex, "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

export function validateMcpOAuthAttempt(
  attempt: OAuthAttemptSnapshot,
  callbackState: string,
  now = new Date()
): McpOAuthAttemptValidation {
  if (attempt.consumedAt) return { ok: false, reason: "consumed" }
  if (attempt.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" }
  }
  if (!hashesMatch(attempt.stateHash, hashMcpOAuthState(callbackState))) {
    return { ok: false, reason: "state_mismatch" }
  }
  return { ok: true }
}

const OAUTH_STATUS_TRANSITIONS: Record<
  McpServerOAuthStatus,
  readonly McpServerOAuthStatus[]
> = {
  pending: ["pending", "needs_tool_review"],
  needs_tool_review: [
    "needs_tool_review",
    "connected",
    "pending",
    "reauthorization_required",
  ],
  connected: ["connected", "pending", "reauthorization_required"],
  reauthorization_required: ["reauthorization_required", "pending"],
}

export function initialMcpServerOAuthStatus(
  authMode: McpServerAuthMode
): McpServerOAuthStatus | null {
  return authMode === "oauth" ? "pending" : null
}

export function canTransitionMcpServerOAuthStatus(
  from: McpServerOAuthStatus | null,
  to: McpServerOAuthStatus
): boolean {
  if (from === null) return to === "pending"
  return OAUTH_STATUS_TRANSITIONS[from].includes(to)
}

export function assertMcpServerOAuthStatusTransition(
  from: McpServerOAuthStatus | null,
  to: McpServerOAuthStatus
): void {
  if (!canTransitionMcpServerOAuthStatus(from, to)) {
    throw new Error(`Invalid MCP OAuth status transition: ${from} -> ${to}`)
  }
}
