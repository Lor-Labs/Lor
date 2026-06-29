# Adding a Connector

A runbook for wiring a new integration (Linear, Notion, Datadog, …) end to end. Use GitHub as the reference implementation — every step below points at its files.

There are three concerns, plus UI. Some steps the **compiler enforces** (you can't forget them); others are **silent** (you must remember). Each step is tagged `[compiler]` or `[manual]`.

---

## 1. Connect / auth (provider-specific — irreducible)

1. **Add the provider to the DB enum** — `packages/db/src/schemas/integration-connections.ts` → `integrationProviderEnum`. `[manual]` then `pnpm db:push`.
2. **Auth flow.** GitHub uses an App install redirect; an OAuth connector needs an authorize URL + callback that exchanges the code and stores the token (+ refresh). Tokens that expire need a refresh path.
   - API: `apps/api/src/routes/v1/integrations/<provider>/` (see `github/index.ts`) and the connect handler in `apps/api/src/routes/v1/integrations/handlers.ts`.
   - Web: the post-auth landing page, e.g. `apps/web/src/routes/_authenticated/integrations/<provider>/setup.tsx`.
3. **Surface it in `listIntegrations`** — `apps/api/src/routes/v1/integrations/handlers.ts`. The `providers: [...]` array is **hardcoded**; add an entry (id, name, `connectUrl`, connection status). `[manual]` — silent if forgotten (the card just won't appear).
4. **Env** — add any secrets to `packages/env/src/server.ts`. If a field is **required**, mirror it into `apps/api/vitest.config.ts` `TEST_ENV` or unrelated API tests fail with a cryptic ZodError. `[manual]`
5. **Webhooks** (optional) — only if you ingest/notify. `apps/api/src/routes/v1/integrations/<provider>/events.ts`, registered like `registerGithubHandlers`.

## 2. Read / provider logic (irreducible)

6. **Implement `SourceProvider`** — `packages/merlin/src/providers/<provider>.ts` (`fetchContent`, `verifyConnection`). Model on `providers/github.ts`.
7. **Register it** — `packages/merlin/src/providers/index.ts` `providers` map. ⚠️ This map is `Partial<Record<Provider, SourceProvider>>`, so a missing entry is **silent** `[manual]`, not a compile error.

## 3. Use / Merlin tools + capabilities

8. **Build the tools** — a module like `packages/merlin/src/github.ts` (`buildXTools`) exposing the connector's tools. `[manual]`
9. **Add the capability** — `packages/db/src/schemas/agent-profiles.ts` → `merlinCapabilityEnum`. `[manual]` then `pnpm db:push`.
10. **Describe the capability** — `apps/api/src/lib/agent-capabilities.ts` → `CAPABILITY_CATALOG` (label, description, `requires: [<provider>]`). `[compiler]` — the `Record<MerlinCapability, …>` type makes step 9 fail to compile until you do this. This is also what auto-hides the capability in the profile editor until the connector is connected.
11. **Gate + register the tools in `respond()`** — `packages/merlin/src/index.ts`: resolve the connection only when the capability is granted, and register the tools behind `caps.includes("<capability>") && <connected>`. Mirror the `github`/`code` pattern. `[manual]`
    - If write-back could see these tool calls in history, remember it does **not** need the tools (see the write-back note in `reference/github-connector.md`).

## 4. UI

12. **Provider icon** — `apps/web/src/components/workspace/workspace-settings-dialog.tsx` `PROVIDER_ICONS`. `[manual]` — falls back to a generic plug if missing.
13. The connect/disconnect card and (phase 3) the agent-profile editor render from the API responses (steps 3 + 10), so no extra per-connector UI beyond the icon.

---

## Quick checklist

- [ ] `integrationProviderEnum` + `pnpm db:push`
- [ ] Auth flow (authorize/callback or app-install) + connect handler
- [ ] `listIntegrations` provider entry
- [ ] Env vars (+ mirror required ones into API `TEST_ENV`)
- [ ] (opt) Webhook handlers
- [ ] `SourceProvider` impl + register in `providers/index.ts`
- [ ] Tool module
- [ ] `merlinCapabilityEnum` + `pnpm db:push`
- [ ] `CAPABILITY_CATALOG` entry (compiler-forced)
- [ ] Gate + register tools in `respond()`
- [ ] Provider icon

## Reducing the touch points later

Most of the `[manual]` steps could derive from one **connector manifest** — a single declaration of `{ id, label, icon, authType, capabilities, provider, webhooks }` that `listIntegrations`, the icon map, the provider registry, and the capability catalog all read from. That would turn ~6 hand-edited spots into one, and make the `Partial<Record>` / hardcoded-array drift impossible. Deferred — documenting first; revisit if connectors land frequently.
