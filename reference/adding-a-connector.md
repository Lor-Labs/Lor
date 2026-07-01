# Adding a Connector

A runbook for wiring a new integration (Notion, Datadog, …) end to end. Two connectors are the reference implementations — **GitHub** (a GitHub App) and **Linear** (OAuth) — every step points at their files. Pick whichever auth model matches yours.

## How it works

The two DB enums are the source of truth: `integrationProviderEnum` (`packages/db/src/schemas/integration-connections.ts`) and `merlinCapabilityEnum` (`packages/db/src/schemas/agent-profiles.ts`). The registry in **`@repo/connectors`** and several consumer maps are **exhaustive `Record<enum, …>`**, so **adding an enum value cascades compile errors that walk you through wiring the rest**. Steps tagged `[compiler]` can't be forgotten; `[manual]` ones can — the checklist at the bottom is your guard for those.

## 1. Declare it

1. **Provider enum** — add to `integrationProviderEnum`, then `pnpm db:push`. `[manual]`
2. **Connector descriptor** — add to `@repo/connectors` `CONNECTORS` (`id`, `label`, `description`, `authType`, `envKeys`). `[compiler]` — exhaustive over the provider enum.
3. **Capability enum** — add a value to `merlinCapabilityEnum` per gated ability (e.g. a read cap and a write cap), then `pnpm db:push`. `[manual]`
4. **Capability descriptor(s)** — add to `@repo/connectors` `CAPABILITIES` (`key`, `label`, `description`, `connector`). `[compiler]` — exhaustive over the capability enum. Auto-feeds the profile editor's available-capabilities, channel resolution, and the agent-profiles API (which derives each cap's `connector` + `connectorLabel` from the registry).

## 2. Connect / auth (provider-specific — irreducible)

5. **Auth flow** — `[manual]`
   - **`github-app`:** GitHub redirects to a setup page (`apps/web/src/routes/_authenticated/integrations/github/setup.tsx`) that POSTs the installation id to the `connectGithub` handler.
   - **`oauth`:** build the authorize URL server-side in `connectUrlFor` (`integrations/handlers.ts`, switch on `authType`) → provider consents → redirects to a web callback (`apps/web/src/routes/_authenticated/integrations/<provider>/callback.tsx`) that POSTs the `code` to a `connect<Provider>` handler. The handler exchanges the code via the merlin provider's `connect<Provider>` (see `providers/linear.ts`) and persists the connection with an advisory lock + globally-unique-`externalId` guard (mirror `connectLinear` in `integrations/handlers.ts`). Register the connect endpoint in `integrations/{routes,schema,index}.ts`.
   - **Token storage (OAuth):** access/refresh tokens live encrypted at rest on `integration_connection` (`accessToken`/`refreshToken`/`tokenExpiresAt`/`scope`), via `@repo/utils/crypto` (AES-256-GCM). Refresh on demand + re-persist (see `getLinearAccessToken`). Requires `INTEGRATION_ENCRYPTION_KEY`.
6. **Env** — secrets in `packages/env/src/server.ts`. Keep them **optional** so the connector self-gates to Unavailable when unset (this also avoids `TEST_ENV` coupling). Add cross-field checks in the `refinedServerSchema` superRefine (e.g. client id/secret together; encryption key required when the connector is configured). OAuth connectors also use `APP_BASE_URL` (has a dev default) for the redirect URI. Only a **required** field must be mirrored into `apps/api/vitest.config.ts` `TEST_ENV`, or API tests fail with a cryptic ZodError. `[manual]`
7. **Webhooks** (optional) — a plain (non-OpenAPI) route at `integrations/<provider>/index.ts` that verifies the signature, acks fast, and handles lifecycle (e.g. revoke → drop the connection). GitHub fans many events through `events.ts` (`registerGithubHandlers`, octokit); Linear inlines a single lifecycle case (`LinearWebhookClient`). Register the router in `integrations/index.ts` (`.route("/", <provider>Router)`). `[manual]`
8. **`listIntegrations`** — registry-driven: it iterates `CONNECTOR_LIST`, so a new connector shows up automatically. You only add a branch to `connectUrlFor` for your `authType` (the `oauth` branch currently builds the Linear authorize URL; generalize per-provider as needed), plus any provider-specific card enrichment (GitHub's repo list is a localized special-case in the loop). `[manual]` — small, but not compiler-forced.

## 3. Read / provider logic (irreducible)

9. **`SourceProvider`** — implement in `packages/merlin/src/providers/<provider>.ts` (`fetchContent`, `verifyConnection`) and register in `providers/index.ts`. `[compiler]` — exhaustive `Record<IntegrationProvider, SourceProvider>`. Re-export any connect/token helpers (e.g. `connectLinear`, `getLinearAccessToken`) from `providers/index.ts` for the API to consume.

## 4. Tools

10. **Tool module** — `packages/merlin/src/<provider>.ts` (`buildXTools`, plus a write variant if you have a write cap). Return **meaningful results**: search tools return arrays of `{ title, url, … }`; write tools echo back what they created (the body/description) so the tool-trail card can show it, not just "ok". `[manual]`
11. **Gate + register in `respond()`** — resolve the connection only when the capability is granted, then register the tools behind `caps.includes("<capability>") && <connected>` (mirror `github`/`code`/`linear`). This wiring stays **explicit by design** — with a handful of connectors it's clearer than a tool-factory registry. Write-back does **not** get connector tools. `[manual]`
12. **System-prompt line** — add a `<PROVIDER>_PROMPT_LINE` describing the tools and include it in `connectorPromptLines` in `respond()`, gated on the same `caps`/connection check. This keeps Merlin from being told about tools a channel doesn't have bound. `[manual]`
13. **Tool-trail labels/details** — add `toolLabel` + `toolDetail` cases in `packages/merlin/src/index.ts` for each new tool. Surface real content: search → `items`; writes → the created body in `summary`. Missing cases degrade to a generic label (safe, but do it). `[manual]`

## 5. UI

14. **Connector presentation** — one entry in `apps/web/src/lib/connector-ui.tsx` `CONNECTOR_UI`: `logo`, `urlHost` (matches result URLs → connector, for trail link icons), and `tools` (the **hand-maintained list** of this connector's tool names, for trail row icons — keep it in sync with the tool module). `[compiler]` for `logo` (exhaustive `Record<ConnectorKey, …>`); `tools`/`urlHost` are hand-kept.
    - Everything else derives from here: capability tile/chip icons, the profile-editor group header, and the integration card all call `connectorLogo(connector)`. There is **no** separate capability-icon or provider-icon map to maintain.
    - Logo asset: `@repo/ui/components/logos/<provider>` (brand SVGs live there) or a lucide glyph. Wrap a filled logomark with `fill-current` so it inherits the surrounding color. (Settings/config dialogs use lucide, not HugeIcons.)

---

## Quick checklist

- [ ] `integrationProviderEnum` + `pnpm db:push`
- [ ] `CONNECTORS` descriptor (`@repo/connectors`) — compiler-forced
- [ ] `merlinCapabilityEnum` + `pnpm db:push`
- [ ] `CAPABILITIES` descriptor(s) (`@repo/connectors`) — compiler-forced
- [ ] Auth flow + connect handler (+ callback route + connect endpoint for OAuth)
- [ ] Env vars (optional; cross-field refine; mirror any *required* field into API `TEST_ENV`)
- [ ] (opt) Webhook route + register in `integrations/index.ts`
- [ ] `connectUrlFor` branch + any card enrichment (`listIntegrations` iterates the registry)
- [ ] `SourceProvider` impl + register — compiler-forced
- [ ] Tool module (results echo real content)
- [ ] Gate + register tools in `respond()` (explicit)
- [ ] System-prompt line in `connectorPromptLines`
- [ ] `toolLabel` / `toolDetail` cases
- [ ] `connector-ui.tsx` entry: `logo` (compiler-forced) + hand-kept `tools` + `urlHost`

## Registry status

`@repo/connectors` holds the typed, exhaustive descriptors (`CONNECTORS`, `CAPABILITIES`); the capability catalog, `SourceProvider` map, `listIntegrations`, and all connector logos derive from it (the enums make omissions compile errors). The client-side presentation registry is `apps/web/src/lib/connector-ui.tsx` — the single home for connector logos plus the hand-kept tool-name / URL-host associations the tool trail uses. Two things stay **deliberately explicit** rather than registry-generated — the `respond()` tool wiring and the `connector-ui` `tools` list — because at this scale hand-written is clearer and the tool names are cheap to keep in sync; the checklist covers them.
