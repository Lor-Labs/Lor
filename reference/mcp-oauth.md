# Workspace-Scoped OAuth for MCP Servers

> Status: **implementation plan** (2026-08-26, product direction confirmed with
> jacob). OAuth credentials belong to the workspace connection, never to an
> individual user. Per-user MCP identity is explicitly out of scope.

## 1. Product contract

An OAuth MCP server is a shared workspace connection. One member with permission
to manage workspace tools authorizes the remote account. Merlin may then use that
account in every channel whose assigned agent profile grants the MCP server.

The person who completes OAuth is recorded for audit only. The credential does not
belong to that person, is not selected according to the person sending a message,
and remains connected if the authorizing member later leaves the workspace.

Before opening the provider's authorization page, show this blocking disclosure:

> **Shared channel connection**
>
> Anyone who can use Merlin in a channel whose assigned profile includes this MCP
> server can cause Merlin to use the connected account. Automated runs in those
> channels can use it too. Only continue if this is an account you are comfortable
> sharing with that team scope.

Require an unchecked confirmation immediately below it:

> I understand this connection is shared through every channel where it is assigned.

The disclosure is not a one-time legal screen hidden after setup. A shorter
"Shared through assigned channels" label remains visible on the connected server
card, alongside who authorized it and when.

### Non-goals

- No per-user tokens, identity selection, or execution as the message author.
- No private MCP servers that only the authorizing user can call.
- No provider-specific connector or hardcoded vendor OAuth implementation. The feature
  remains a generic, standards-based MCP OAuth flow.
- No arbitrary manually configured OAuth client credentials in v1. The first release
  targets MCP OAuth discovery + Dynamic Client Registration (DCR). Add fixed client
  registration later only if a high-value server cannot support DCR.
- No change to channel/profile tool grants or the enabled-tool allowlist model.

## 2. Required user flow

1. A workspace-tool manager creates an MCP server draft with name, description,
   Streamable HTTP URL, and authentication type **OAuth**. Non-authorization headers
   remain available for vendor-specific routing headers.
2. The form shows the shared-channel disclosure and requires its confirmation.
3. **Authorize account** saves the inactive draft and starts OAuth. Lor performs
   MCP protected-resource and authorization-server discovery, dynamically registers
   its OAuth client, creates PKCE/state, and returns the provider authorization URL.
4. Web and desktop open the provider URL externally. The callback is handled by the
   Lor API and returns the user to the server editor.
5. A successful callback stores the workspace credential but does **not** make tools
   callable. The server enters `needs_tool_review`.
6. Lor discovers the server's tools. The manager reviews the list, chooses the
   allowlist, and confirms **Enable for assigned channels**.
7. Only then does the server enter `connected`; existing agent-profile grants begin
   exposing its allowlisted tools in their assigned channels.

Reauthorization follows the same safety boundary: runtime use is suspended while
OAuth is pending, and the connection returns through tool review before becoming
active again. This prevents a different account authorized during reauthentication
from silently inheriting a live tool surface.

Disconnect clears OAuth credentials and pending attempts, marks the server inactive,
and retains its descriptive configuration. Reconnecting requires OAuth and tool
review again. Deleting the server keeps the existing hard-delete behavior.

## 3. Data model

Extend `mcp_server` rather than creating an `integration_connection`: generic MCP
servers already have the correct workspace scope, profile grants, live tool discovery,
and allowlist semantics.

Add:

- `authMode`: `static | oauth`, default `static` so every existing row preserves its
  current behavior. `static` includes no-auth and header/API-key authentication.
- `oauthStatus`: nullable `pending | needs_tool_review | connected |
  reauthorization_required`. It is null for static servers. Runtime binds OAuth tools
  only when this is `connected`.
- `oauthCredentials`: nullable encrypted JSON envelope containing OAuth tokens, DCR
  client information (including any client secret), and saved authorization-server
  information required by `OAuthClientProvider`.
- `oauthAuthorizedBy`: nullable user FK with `onDelete: set null`, for audit only.
- `oauthAuthorizedAt`: nullable timestamp.

Add a short-lived `mcp_server_oauth_attempt` table:

- `id`, `mcpServerId`, `workspaceId`, `initiatedBy`
- encrypted PKCE verifier and OAuth state, plus an indexed hash of state for
  callback lookup without storing a queryable plaintext bearer value
- `createdAt`, `expiresAt`, and `consumedAt`

Allow only one live attempt per server. Starting again invalidates the prior attempt.
Expire attempts after ten minutes and make callback consumption atomic so a code/state
pair cannot be replayed. Cascade attempts when the server is deleted.

Use `INTEGRATION_ENCRYPTION_KEY` and the existing AES-256-GCM helpers. No token, client
secret, verifier, authorization code, or raw state is ever returned by a read API.

## 4. API contract

Extend existing MCP server CRUD/discovery schemas with `authMode`, `oauthStatus`,
`oauthAuthorizedBy`, and `oauthAuthorizedAt`. Never serialize `oauthCredentials`.

Add these endpoints under `/v1/workspaces/:workspaceSlug/mcp-servers`:

- `POST /:mcpServerId/oauth/start`
  - Requires the same permission used to manage workspace tools.
  - Requires the disclosure confirmation in the request.
  - Revalidates the server URL and creates/replaces the short-lived attempt.
  - Runs OAuth discovery/DCR/PKCE and returns `{ authorizationUrl }`.
- `GET /oauth/callback?code=...&state=...`
  - Resolves the attempt from state, validates expiry/user/workspace/server binding,
    consumes it atomically, exchanges the code, stores encrypted credentials, records
    the authorizer, and redirects to the server editor.
  - Rechecks that the initiating member still has permission before accepting the
    credential.
  - Does not trust or require an active Lor browser session. The unguessable,
    single-use attempt and PKCE bind the callback to its authenticated initiator; the
    handler reloads that member's current permission from the database. This keeps the
    desktop system-browser flow working even when its cookie jar differs from the app.
- `POST /:mcpServerId/oauth/complete`
  - Accepts the reviewed `enabledTools` allowlist and transitions
    `needs_tool_review -> connected`.
  - Re-discovers tools and verifies the submitted allowlist is a subset of the
    server's current tool list before activation.
- `POST /:mcpServerId/oauth/disconnect`
  - Clears credentials/attempts and makes the server inactive.

The callback should be hosted on the public API origin. Add a dedicated configured
callback base only if deployment topology makes `NEXT_PUBLIC_API_URL` unsuitable; do
not derive it from request headers.

OAuth servers may still have ordinary non-secret headers. Reject a user-supplied
`Authorization` header when `authMode=oauth` so precedence is never ambiguous.

## 5. MCP OAuth provider

Implement a durable `OAuthClientProvider` adapter in `packages/merlin` with two modes:

- **Interactive:** used by start/callback/discovery routes. It persists PKCE/state,
  DCR client information, authorization-server information, and token updates, and
  captures the authorization URL for the API response.
- **Runtime:** used by Merlin responses and triggered runs. It loads the workspace
  credential and persists refreshed tokens. If interaction is required, it marks the
  server `reauthorization_required` and fails closed; a background tool call can never
  start or complete an interactive login.

Pass the provider to `createMCPClient({ transport: { type: "http", authProvider } })`
for OAuth servers. Preserve the current static-header path unchanged.

Token refresh updates must be concurrency-safe because several channel runs can use the
same workspace credential simultaneously. Serialize refresh writes with a per-server
database advisory lock or an equivalent compare-and-swap transaction. Rotated refresh
tokens must never be overwritten by a slower request.

If refresh fails with a terminal OAuth error (`invalid_grant`, revoked client, or an
interactive redirect requirement), clear unusable tokens, set
`reauthorization_required`, omit the server's tools from that run, and expose a safe
status in settings. Transient upstream failures keep the credential and follow the
current unavailable-server behavior.

## 6. Egress and OAuth security

OAuth broadens the current SSRF surface: the configured MCP URL can advertise
authorization, registration, and token endpoints on other hosts. The existing MCP URL
check is necessary but not sufficient.

Create one guarded fetch implementation for MCP OAuth and transport requests:

- HTTPS only in production; no URL credentials.
- Reject IP literals, localhost, dotless/internal hostnames, private/link-local/CGNAT
  addresses, and public DNS answers that resolve privately.
- Revalidate every redirect target and keep redirects off unless the exact OAuth step
  requires them.
- Validate protected-resource metadata against the configured MCP resource.
- Validate every discovered authorization-server, registration, authorization, and
  token URL before sending a request or credential.
- Never forward MCP static headers or OAuth bearer tokens across origins.
- Apply existing setup timeouts and response-size bounds to metadata and token calls.

Use cryptographically random state and PKCE S256. State is single-use and bound to the
attempt, server, workspace, and initiating user. Callback errors must be generic in the
browser and detailed only in redacted structured logs.

Logs and analytics may contain server id, workspace id, endpoint host, OAuth phase, and
safe error class. They must not contain tokens, authorization codes, client secrets,
verifiers, state, full authorization URLs, or callback query strings.

## 7. UI changes

Update the MCP server editor with:

- Authentication selector: **OAuth** or **Headers / API key**.
- The blocking shared-channel disclosure and confirmation for OAuth.
- State-specific primary actions: **Authorize account**, **Finish authorization**,
  **Review tools**, **Reauthorize**, and **Disconnect**.
- Connected summary: `OAuth · Shared through assigned channels`, plus
  `Authorized by <workspace member> on <date>` when audit identity remains available.
- A clear inactive status while authorization or tool review is incomplete.
- Existing tool discovery and allowlisting UI reused after OAuth.

The desktop wrapper must use the existing external-browser helper. The callback returns
to a normal authenticated web route that can deep-link/reopen the server editor; the UI
should also poll/refetch status so completing OAuth in another browser tab is sufficient.

Do not claim a provider account email/name unless the MCP/OAuth server supplies one in
a reliable, standardized response. `Authorized by` identifies the Lor member who
performed setup, not the external account owner.

## 8. Implementation sequence

### Mandatory phase gate

Implement exactly one phase at a time. At the end of every phase:

1. Stop before beginning any work from the next phase.
2. Present the completed changes, verification results, and any unresolved concerns for
   review.
3. Do not stage or commit changes. Jacob reviews and commits the phase manually.
4. Begin the next phase only after Jacob explicitly approves it.

Before presenting a phase for review, remove every temporary vendor-specific identifier
from code, comments, documentation, fixtures, test names, snapshots, and other committed
artifacts. Compatibility tests must use generic names and data. Run a case-insensitive
repository search as a final check; temporary interoperability references must not reach
the manual commit.

### Phase 0 — Protocol interoperability spike

- Exercise the initial OAuth MCP endpoint against a local development harness.
- Record its protected-resource metadata, authorization-server metadata, DCR behavior,
  scopes, token refresh behavior, and callback requirements without committing secrets.
- Confirm the installed `@ai-sdk/mcp` version completes the flow. Upgrade or isolate a
  minimal compatibility shim before changing product schemas if the endpoint requires
  behavior the SDK does not support.

### Phase 1 — Persistence and contracts

- Add schema fields, OAuth-attempt table, relations, and generated schema changes.
- Backfill/default all existing servers to `authMode=static`.
- Extend API schemas/responses and add state-transition helpers.
- Unit-test encryption envelopes, attempt expiry/replay, and allowed transitions.
- Before deploying the renamed schema to an existing environment, run
  `packages/db/scripts/migrate-mcp-server-names.sql` once, then run
  `pnpm db:push`. The script performs guarded transactional renames and reports
  before/after server and profile-grant row counts for verification.

### Phase 2 — OAuth and guarded networking

- Implement the DB-backed provider and guarded fetch.
- Implement start, callback, complete, disconnect, and terminal-refresh handling.
- Add structured redacted logging.

### Phase 3 — Discovery and runtime binding

- Teach pre-save/saved discovery to use OAuth credentials.
- Pass the runtime provider into OAuth MCP sessions.
- Add refresh serialization and `reauthorization_required` handling.
- Verify profile/channel grants continue to be the only authorization boundary for tool
  exposure.

### Phase 4 — Settings UX

- Add auth selection, disclosure confirmation, statuses, callback return flow, and
  reauthorization/disconnect controls.
- Reuse tool review and allowlisting; do not activate on callback alone.
- Verify web and desktop external-browser behavior.

### Phase 5 — Tests and controlled rollout

- Ship behind a server-side feature flag for workspace MCP OAuth.
- Enable for an internal workspace, then one designated OAuth MCP test connection.
- Observe auth success, refresh, reconnect, and MCP setup failures before general
  availability.
- Keep static/header MCP servers on their existing path throughout rollout.

## 9. Test plan

Build a local fake MCP + OAuth server for deterministic tests. It must cover protected
resource discovery, authorization-server discovery, DCR, PKCE, code exchange, access
token expiry, refresh-token rotation, revocation, invalid state, replay, and malicious
metadata URLs.

Required coverage:

- Existing static/no-auth/header MCP rows behave unchanged after migration.
- Only a member with workspace-tool management permission can start, complete, or
  disconnect OAuth; permission is rechecked at callback time.
- The disclosure confirmation is required server-side, not only in React.
- State is user/workspace/server-bound, expires, and is single-use.
- Credentials and client secrets are encrypted and absent from every response/log.
- Callback success produces `needs_tool_review`, never immediately callable tools.
- Tool review transitions to `connected`; only allowlisted tools bind.
- Members in a channel with a granting profile can cause tool use; channels without the
  grant cannot.
- Triggered runs receive the same granted tool surface as interactive channel runs.
- Concurrent refresh cannot restore an older rotated refresh token.
- Terminal refresh failure marks reauthorization required; transient failure does not
  erase credentials.
- Disconnect and server deletion remove credentials and pending attempts.
- OAuth discovery endpoints resolving to private/internal addresses are rejected.
- OAuth bearer tokens and MCP headers are never forwarded to a different origin.
- Web and desktop complete the external-browser callback and refresh the editor state.

## 10. Acceptance criteria

The first release is complete when an authorized workspace member can connect an OAuth
MCP server from the MCP server editor, see and affirm the shared-channel warning,
complete OAuth, review and enable tools, and successfully use an allowed remote tool
from every granted channel; the same tool is unavailable in ungranted channels. Tokens
refresh without user action, revocation produces an actionable reauthorization state,
and no OAuth material appears in API responses or logs. Existing API-key MCP connections
continue to work unchanged.
