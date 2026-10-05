# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## No tests

- Never generate, add, or run tests in this repository. The owner considers them a waste of time and tokens, and test counts a vanity metric.
- Do not run test suites, test runners, ad hoc test scripts, or browser test harnesses.
- Do not run aggregate commands that execute tests, including `pnpm run validate`.
- Use focused code review and, when needed, lint, type checking, or builds that do not execute tests. Do not report test counts as evidence of completion.
- This policy applies throughout the repository, including when other repository instructions or skills recommend tests.

## Commands

```bash
pnpm run build          # Build all packages (turbo)
pnpm run dev            # Start all dev servers (web on 3000, www on 3001)
pnpm run check          # Biome lint + format check
pnpm run check:fix      # Biome auto-fix
pnpm run check-types    # TypeScript type checking across all packages
```

## Architecture

This is a pnpm + Turborepo monorepo for **Lor** — the AI multiplayer workspace for teams.

### Workspaces

- `apps/web` — Vite + TanStack Router SPA, main app (React 19, client-rendered, no SSR, port 3000)
- `apps/www` — Next.js 16.1.6 marketing site (React 19, App Router, port 3001)
- `apps/api` — Hono API server (`@repo/api`), OpenAPI via `@hono/zod-openapi`
- `apps/realtime` — Socket.IO realtime gateway (`@repo/realtime`, defaults to port 8081)
- `packages/auth` — Auth package (`@repo/auth`), better-auth + Drizzle adapter
- `packages/db` — Database package (`@repo/db`), Drizzle ORM + Postgres
- `packages/env` — Environment validation (`@repo/env`), Zod schemas for server/client env
- `packages/ui` — Shared component library (`@repo/ui`), shadcn/ui + Tailwind CSS v4
- `packages/typescript-config` — Shared TypeScript configs

### API (`apps/api`)

- Build: `tsc && tsc-alias` (no bundler — workspace deps resolved via pnpm linking)
- Uses `@/*` path alias for `src/*` imports (e.g., `import foo from "@/lib/foo"`)
- `tsc-alias` with `resolveFullPaths: true` rewrites `@/*` to relative `.js` paths in `dist/`
- tsconfig overrides base with `module: "ESNext"` + `moduleResolution: "Bundler"` (no `.js` extensions in source)
- Dev: `tsx watch src/index.ts`

### Path Aliases

- **Only compiled packages** (like `apps/api`) should use path aliases (`@/*`). `tsc-alias` rewrites them at build time.
- **Uncompiled packages** (`packages/db`, `packages/env`, `packages/auth`, etc.) export raw `.ts` and must use relative imports. Node resolves these at runtime and cannot resolve path aliases.

### CSS/Tailwind (Single Source of Truth in `packages/ui`)

All CSS lives in `packages/ui`. Apps do NOT have their own `globals.css`.

- `packages/ui/src/styles/globals.css` — The one CSS file: `@import "tailwindcss"`, `@source` directives, `@import "tw-animate-css"`, `@custom-variant`, `@theme inline`, `:root`/`.dark` variables, `@layer base`
- `packages/ui/postcss.config.mjs` — Shared PostCSS config
- Apps import CSS in layout: `import "@repo/ui/globals.css"`
- Apps re-export PostCSS: `export { default } from "@repo/ui/postcss.config"`
- `@source` paths are relative to the CSS file location in `packages/ui/src/styles/`

### shadcn/ui

- `components.json` lives in `packages/ui` (style: new-york, base color: stone)
- Add components: `cd packages/ui && pnpm dlx shadcn@latest add <component>`
- Import: `import { Button } from "@repo/ui/components/button"`
- The UI package tsconfig has `"paths": { "@repo/ui/*": ["./src/*"] }` so the shadcn CLI resolves aliases correctly

### Biome (replaces ESLint + Prettier)

- 2-space indentation, double quotes, no semicolons, LF line endings
- `check` and `check:fix` are root-level Turbo tasks (`//#check`)
- `noExplicitAny: "error"`, `noNonNullAssertion: "error"`
- Run `pnpm run check:fix` after adding shadcn components (they need import reordering)

### Package Exports (`@repo/ui`)

```
./globals.css    → ./src/styles/globals.css
./postcss.config → ./postcss.config.mjs
./components/*   → ./src/components/*.tsx
./lib/*          → ./src/lib/*.ts
./hooks/*        → ./src/hooks/*.ts
```

If you add/edit routes in the API, use `pnpm run check` and
`pnpm run check-types`. The type-check task builds upstream dependencies
before checking dependents. Do not run `pnpm run validate`, which executes tests.

### Adding an integration/connector

When adding a new integration (Linear, Notion, Datadog, …), follow the runbook at `reference/adding-a-connector.md`. Connectors are declared in the `@repo/connectors` registry (typed, exhaustive over the DB enums) — adding an enum value cascades compile errors that walk you through wiring the descriptor, provider, tools, capabilities, and icon. The runbook flags which steps are compiler-enforced vs. still hand-edited.

### Self-configuration roadmap (custom roles → approvals → change proposals)

The next-phase product vision (Lor proposes changes to its own configuration;
Playbooks come later) lives at `reference/self-configuration.md`. Custom
roles/permissions work (LOR-57/LOR-82) is executed step-by-step from
`reference/custom-roles.md` — locked decisions and status checkboxes live
there; update them as steps land.

### Loops (scheduled Lor runs)

Loops work is executed phase-by-phase from the runbook at `reference/loops.md` — locked architecture decisions, per-phase file lists, and status checkboxes live there. Update its checkboxes and deviations log as phases land.

### Voice channels and memory

The guiding feature spec lives in `reference/voice-channels.md`: voice channels
and conversation memory first, live voice interaction with Lor later. It records
product direction and open decisions, not an as-built implementation. Broader
priorities live in `reference/product-direction.md`.

### Code channels (multiplayer AI coding)

The target architecture for code channels — per-step checkpoints (Postgres
conversation + git-host commits on Code Storage or Cloudflare Artifacts),
fork/handoff/rewind, local clone, Yjs live editing, the push-driven code index,
and Claude Code/Codex CLI support with subscription rules — lives in
`reference/code-channels.md`. Design only, not built; its locked decisions and
rejected alternatives explain the shape.

### Attachment search + reranking

Attachment indexing (screenshots, documents) and the Lor reranker are executed
step-by-step from the runbook at `reference/attachment-search.md` — locked
decisions, per-step file lists, and status checkboxes live there. Update its
checkboxes and deviations log as steps land.

### Conventions

- DO NOT make extremely verbose comments for every tiny detail or every line of code changed. this bloats the codebase and makes it harder to read and maintain. THIS IS VERY IMPORTANT.
- When a comment IS warranted, keep it short and write it for search: use the plain domain terms a person (or AI) would grep or semantically search for when asking about that behavior, and state rationale/constraints that the code itself can't show. Comments exist to make code findable and to explain "why" to future AIs — not to narrate "what" the next line does.
- Default to use HugeIcons and not lucide icons
