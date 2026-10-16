# Adding a Connector

A runbook for wiring a new integration (Notion, Sentry, …) end to end. Three connectors are the reference implementations — **GitHub** (a GitHub App), **Linear** (OAuth), and **Datadog** (api-key + MCP-backed tools) — every step points at their files. Pick whichever auth model matches yours.

## How it works

`integrationProviderEnum` (`packages/db/src/schemas/integration-connections.ts`) is the source of truth for connector IDs. The registry in **`@repo/connectors`** and provider maps are exhaustive over it, so adding a provider walks you through the missing wiring with compiler errors. `lorCapabilityEnum` contains only standalone profile abilities; adding a connector or tool requires no capability enum value. Steps tagged `[compiler]` are exhaustive; `[manual]` still need the checklist below.

## 1. Declare it

1. **Provider enum** — add to `integrationProviderEnum`, then `pnpm db:push`. `[manual]`
2. **Connector descriptor** — add to `@repo/connectors` `CONNECTORS` (`id`, `label`, `description`, `authType`, `envKeys`). `[compiler]` — exhaustive over the provider enum.
3. **Tool access and approval** — do not add connector capability enum values. Each catalog tool is selected and approved by its stable name. `[manual]`
4. **Standalone abilities** — only non-connector abilities belong in `CAPABILITIES`. Connector descriptors and their reviewed tool catalog are sufficient for connector access and per-tool approval targets. `[manual]`

## 2. Connect / auth (provider-specific — irreducible)

5. **Auth flow** — `[manual]`
   - **`github-app`:** GitHub redirects to a setup page (`apps/web/src/routes/_authenticated/integrations/github/setup.tsx`) that POSTs the installation id to the `connectGithub` handler.
   - **`oauth`:** build the authorize URL server-side in `connectUrlFor` (`integrations/handlers.ts`, switch on `authType`) → provider consents → redirects to a web callback (`apps/web/src/routes/_authenticated/integrations/<provider>/callback.tsx`) that POSTs the `code` to a `connect<Provider>` handler, then on success navigates to `?settings=workspace&tab=connectors&connector=<provider>` (the connector's detail view). The handler exchanges the code via the lor provider's `connect<Provider>` (see `providers/linear.ts`) and persists the connection with an advisory lock + globally-unique-`externalId` guard (mirror `connectLinear` in `integrations/handlers.ts`). Register the connect endpoint in `integrations/{routes,schema,index}.ts`.
   - **`api-key`:** no redirect — the Connect button opens an in-app form (see `DatadogConnectDialog` in `connectors-section.tsx`) that POSTs the pasted keys to a `connect<Provider>` handler. The lor provider's `connect<Provider>` (see `providers/datadog.ts`) verifies the keys with one cheap authenticated call and returns them encrypted, with `externalId` fingerprinted from the credential (no provider-side org id to use). Persist with the same advisory-lock + upsert shape as OAuth.
   - **Token storage (OAuth):** access/refresh tokens live encrypted at rest on `integration_connection` (`accessToken`/`refreshToken`/`tokenExpiresAt`/`scope`), via `@repo/utils/crypto` (AES-256-GCM). Refresh on demand + re-persist (see `getLinearAccessToken`). Requires `INTEGRATION_ENCRYPTION_KEY`. Api-key connectors store their keys the same way on `apiKey`/`appKey` (+ `site` for multi-region providers).
6. **Env** — secrets in `packages/env/src/server.ts`. Keep them **optional** so the connector self-gates to Unavailable when unset (this also avoids `TEST_ENV` coupling). Add cross-field checks in the `refinedServerSchema` superRefine (e.g. client id/secret together; encryption key required when the connector is configured). OAuth connectors also use `APP_BASE_URL` (has a dev default) for the redirect URI. Only a **required** field must be mirrored into `apps/api/vitest.config.ts` `TEST_ENV`, or API tests fail with a cryptic ZodError. `[manual]`
7. **Webhooks** (optional) — a plain (non-OpenAPI) route at `integrations/<provider>/index.ts` that verifies the signature, acks fast, and handles lifecycle (e.g. revoke → drop the connection). GitHub fans many events through `events.ts` (`registerGithubHandlers`, octokit); Linear inlines Issue create/complete plus the `OAuthApp` revoke case (`LinearWebhookClient`). Linear's webhook is app-level: the URL, signing secret and subscribed event types live in the Lor OAuth application's settings in Linear, not in code. As of 2026-10-07 it subscribes to Issues and Comments only; "OAuth authorization events" must also be on for the revoke case to fire. Register the router in `integrations/index.ts` (`.route("/", <provider>Router)`). `[manual]`
8. **`listIntegrations`** — registry-driven: it iterates `CONNECTOR_LIST`, so a new connector shows up automatically. You only add a branch to `connectUrlFor` for your `authType` (the `oauth` branch currently builds the Linear authorize URL; generalize per-provider as needed), plus any provider-specific card enrichment (GitHub's repo list is a localized special-case in the loop). `[manual]` — small, but not compiler-forced.

## 3. Read / provider logic (irreducible)

9. **`SourceProvider`** — implement in `packages/lor/src/providers/<provider>.ts` (`fetchContent`, `verifyConnection`) and register in `providers/index.ts`. `[compiler]` — exhaustive `Record<IntegrationProvider, SourceProvider>`. Re-export any connect/token helpers (e.g. `connectLinear`, `getLinearAccessToken`) from `providers/index.ts` for the API to consume.

## 4. Tools

10. **Tool catalog** — add reviewed tool names, labels, `readOnlyHint`, and
    `defaultEnabled` to `CONNECTOR_TOOLS` (`packages/connectors/src/tools.ts`).
    New connections save explicit recommended names; saved selections must opt
    in to new tools. There is no legacy configuration fallback. Runtime
    tool groups are intersected with the connection selection after profile
    tool selections. See `reference/connector-tools.md` for the controls and rollout.
    **Tool module** — `packages/lor/src/<provider>.ts` (`buildXTools`, plus a write variant if you have a write cap). Return **meaningful results**: search tools return arrays of `{ title, url, … }`; write tools echo back what they created (the body/description) so the tool-trail card can show it, not just "ok". `[manual]`
    - **MCP-backed alternative:** when the provider runs a managed MCP server (Datadog), skip hand-written tools — open a per-response MCP session and allowlist its tools (see `datadogMcpTools` in `datadog.ts`; `respond()` closes the session in a `finally`). Schemas/descriptions come from the server; the allowlist keeps upstream additions from silently widening Lor's surface.
11. **Gate + register in `respond()`** — resolve the connection only when a catalog tool is selected, register available tool implementations, then intersect by tool name (mirror `github`/`code`/`linear`). This wiring stays **explicit by design** — with a handful of connectors it's clearer than a tool-factory registry. Write-back does **not** get connector tools. Approval binding uses `ToolTargetMap.addBuiltins` for the actual bound names; MCP targets include the server ID and raw tool name. `[manual]`
12. **System-prompt line** — add a `<PROVIDER>_PROMPT_LINE` describing the tools and include it in `connectorPromptLines` in `respond()`, gated on actual bound tool names. This keeps Lor from being told about tools a channel doesn't have bound. `[manual]`
13. **Tool-trail labels/details** — add `toolLabel` + `toolDetail` cases in `packages/lor/src/index.ts` for each new tool. Surface real content: search → `items`; writes → the created body in `summary`. Missing cases degrade to a generic label (safe, but do it). `[manual]`

## 5. Composer attachments

14. **Attachable records** — add a searcher to `SEARCHERS` in `packages/lor/src/connector-search.ts`, returning `{ id, title, subtitle, url }` per record (reuse the provider client the tools already use). `[compiler]` — exhaustive `Record<IntegrationProvider, …>`; `null` means the connector has nothing to attach (Datadog is live log queries), and the composer hides it. An empty query should return recent records where the provider supports it. Both endpoints are registry-driven — no per-connector work: `GET /workspaces/{slug}/channels/{channelId}/connectors` lists what a channel can attach (connected ∩ granted by the channel's agent profile ∩ searchable, via `apps/api/src/lib/channel-connectors.ts`), and `…/connectors/{provider}/search` returns the records.
15. **Attachable files** (optional) — add an entry to `FILE_BROWSERS` in the same file: `listScopes` (the containers files live in — GitHub returns the installation's repos) plus a `search` over one scope's paths. `[compiler]` — exhaustive `Record<IntegrationProvider, …>`; `null` means no file browsing, which is the right answer for most connectors. This registry alone drives the `supportsFiles` flag on the connector list and the `…/connectors/{provider}/scopes` + `…/connectors/{provider}/files` endpoints, so the composer's "Browse files" step appears without any UI change.

## 6. UI

16. **Connector presentation** — one entry in `apps/web/src/lib/connector-ui.tsx` `CONNECTOR_UI`: `logo`, `urlHost` (matches result URLs → connector, for trail link icons), `tools` (the **hand-maintained list** of this connector's tool names, for trail row icons — keep it in sync with the tool module), and `linkLabel` (composer chip text for a pasted url of this connector, derived from the url alone). `[compiler]` for all fields (exhaustive `Record<ConnectorKey, …>`); the compiler can't check the *content* of `tools`/`urlHost`.
    - Everything else derives from here: capability tile/chip icons, the profile-editor group header, and the integration card all call `connectorLogo(connector)`. There is **no** separate capability-icon or provider-icon map to maintain.
    - Logo asset: `@repo/ui/components/logos/<provider>` (brand SVGs live there) or a lucide glyph. Wrap a filled logomark with `fill-current` so it inherits the surrounding color. (Settings/config dialogs use lucide, not HugeIcons.)

---

## Quick checklist

- [ ] `integrationProviderEnum` + `pnpm db:push`
- [ ] `CONNECTORS` descriptor (`@repo/connectors`) — compiler-forced
- [ ] Individual tool names, read-only metadata, and defaults in `CONNECTOR_TOOLS`
- [ ] Individual approval targets bind only to the tools actually exposed
- [ ] Auth flow + connect handler (+ callback route + connect endpoint for OAuth)
- [ ] Env vars (optional; cross-field refine; mirror any *required* field into API `TEST_ENV`)
- [ ] (opt) Webhook route + register in `integrations/index.ts`
- [ ] `connectUrlFor` branch + any card enrichment (`listIntegrations` iterates the registry)
- [ ] `SourceProvider` impl + register — compiler-forced
- [ ] Tool module (results echo real content)
- [ ] Gate + register tools in `respond()` (explicit)
- [ ] System-prompt line in `connectorPromptLines`
- [ ] `toolLabel` / `toolDetail` cases
- [ ] `connector-search.ts` searcher (or explicit `null`) — compiler-forced
- [ ] `connector-search.ts` `FILE_BROWSERS` entry (or explicit `null`) — compiler-forced
- [ ] `connector-ui.tsx` entry: `logo` + `linkLabel` (compiler-forced) + hand-kept `tools` + `urlHost`

## Registry status

`@repo/connectors` holds the typed, exhaustive descriptors (`CONNECTORS`, `CAPABILITIES`); the capability catalog, `SourceProvider` map, `listIntegrations`, and all connector logos derive from it (the enums make omissions compile errors). The client-side presentation registry is `apps/web/src/lib/connector-ui.tsx` — the single home for connector logos, composer chip labels, plus the hand-kept tool-name / URL-host associations the tool trail uses. Attachable records live in a third exhaustive registry, `packages/lor/src/connector-search.ts`, which backs both the composer's `/` menu and its search endpoint. Two things stay **deliberately explicit** rather than registry-generated — the `respond()` tool wiring and the `connector-ui` `tools` list — because at this scale hand-written is clearer and the tool names are cheap to keep in sync; the checklist covers them.
