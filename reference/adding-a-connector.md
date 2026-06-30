# Adding a Connector

A runbook for wiring a new integration (Linear, Notion, Datadog, …) end to end. GitHub is the reference implementation — every step points at its files.

## How it works

The two DB enums are the source of truth: `integrationProviderEnum` (`packages/db/src/schemas/integration-connections.ts`) and `merlinCapabilityEnum` (`packages/db/src/schemas/agent-profiles.ts`). The registry in **`@repo/connectors`** and several consumer maps are **exhaustive `Record<enum, …>`**, so **adding an enum value cascades compile errors that walk you through wiring the rest**. Steps tagged `[compiler]` can't be forgotten; `[manual]` ones can. Two `[manual]` steps below become registry-driven in the Linear pass (flagged ⚠️).

## 1. Declare it

1. **Provider enum** — add to `integrationProviderEnum`, then `pnpm db:push`. `[manual]`
2. **Connector descriptor** — add to `@repo/connectors` `CONNECTORS` (`id`, `label`, `authType`, `envKeys`). `[compiler]` — exhaustive over the provider enum.
3. **Capability enum** — add a value to `merlinCapabilityEnum` per gated ability, then `pnpm db:push`. `[manual]`
4. **Capability descriptor(s)** — add to `@repo/connectors` `CAPABILITIES` (`label`, `description`, `connector`). `[compiler]` — exhaustive over the capability enum; also auto-feeds the profile editor's available-capabilities and channel resolution.

## 2. Connect / auth (provider-specific — irreducible)

5. **Auth flow** — App install (GitHub) or OAuth authorize/callback with token refresh. API `apps/api/src/routes/v1/integrations/<provider>/` + the connect handler in `integrations/handlers.ts`; web post-auth page `apps/web/src/routes/_authenticated/integrations/<provider>/setup.tsx`. `[manual]`
6. **Env** — secrets in `packages/env/src/server.ts`; mirror any **required** field into `apps/api/vitest.config.ts` `TEST_ENV` or API tests fail with a cryptic ZodError. `[manual]`
7. **Webhooks** (optional) — `integrations/<provider>/events.ts`, registered like `registerGithubHandlers`. `[manual]`
8. **`listIntegrations` entry** — `integrations/handlers.ts`; the `providers: [...]` array is still hardcoded. `[manual]` ⚠️ *Linear pass makes this iterate `CONNECTORS`.*

## 3. Read / provider logic (irreducible)

9. **`SourceProvider`** — implement in `packages/merlin/src/providers/<provider>.ts` (`fetchContent`, `verifyConnection`) and register in `providers/index.ts`. `[compiler]` — the map is now exhaustive `Record<IntegrationProvider, SourceProvider>` (was a silent `Partial`).

## 4. Tools

10. **Tool module** — e.g. `packages/merlin/src/<provider>.ts` (`buildXTools`). `[manual]`
11. **Gate + register in `respond()`** — resolve the connection only when the capability is granted, register tools behind `caps.includes("<capability>") && <connected>` (mirror `github`/`code`). `[manual]` ⚠️ *Linear pass makes this a capability→tool-factory registry.*
    - Write-back does **not** need these tools (see `reference/github-connector.md`).

## 5. UI

12. **Capability icon** — `apps/web/src/lib/capability-icons.ts` `CAPABILITY_ICONS`. `[compiler]` — exhaustive over the capability keys.
13. **Provider icon** (integration card) — `PROVIDER_ICONS` in `workspace-settings-dialog.tsx`. `[manual]` — falls back to a plug. (Settings/config dialogs use lucide, not HugeIcons.)

---

## Quick checklist

- [ ] `integrationProviderEnum` + `pnpm db:push`
- [ ] `CONNECTORS` descriptor (`@repo/connectors`) — compiler-forced
- [ ] `merlinCapabilityEnum` + `pnpm db:push`
- [ ] `CAPABILITIES` descriptor(s) (`@repo/connectors`) — compiler-forced
- [ ] Auth flow + connect handler
- [ ] Env vars (+ mirror required into API `TEST_ENV`)
- [ ] (opt) Webhook handlers
- [ ] `listIntegrations` entry ⚠️ (until Linear pass)
- [ ] `SourceProvider` impl + register — compiler-forced
- [ ] Tool module
- [ ] Gate + register tools in `respond()` ⚠️ (until Linear pass)
- [ ] Capability icon (`capability-icons.ts`) — compiler-forced
- [ ] Provider icon (`PROVIDER_ICONS`)

## Registry status

`@repo/connectors` holds the typed, exhaustive descriptors (`CONNECTORS`, `CAPABILITIES`); the capability catalog, provider registry, and capability icon already derive from it (compiler-enforced). **Still hand-edited, to be collapsed in the Linear pass:** the `listIntegrations` array and the `respond()` tool wiring — both deferred on purpose so their generalized shape is designed against a second real connector, not guessed from GitHub alone.
