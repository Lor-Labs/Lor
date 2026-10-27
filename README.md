# Lor

The AI multiplayer workspace for teams.

Lor is a chat-first workspace for software teams. Chat is the interface; **Lor** — the resident AI agent — is the product. It indexes everything that happens in your workspace (messages, threads, voice transcripts, integrations) and answers questions about your team's history, decisions, and ongoing work. Think "Glean for small teams," open-source and self-hostable.

## Why Lor?

- **Open source & self-hostable** — AGPL-licensed; run it on your own infra or use the hosted version
- **Chat-native institutional memory** — Lor lives where the work happens, not behind a separate search bar
- **For software teams** — not a community-chat platform; designed around how engineering orgs actually communicate

## Project Structure

This is a pnpm + Turborepo monorepo:

```
apps/
  web/          — Primary chat app (Vite + React + TanStack Router)
  www/          — Marketing site & waitlist (Next.js)
  api/          — Hono API server
  realtime/     — Socket.IO realtime gateway
  desktop/      — Desktop client
  mobile/       — Mobile client
  transcriber/  — Speech-to-text service
  worker/       — Background worker

packages/
  api-client/   — Shared type-safe Hono API client
  auth/         — Better Auth configuration and helpers
  ui/           — Shared shadcn/ui component library
  db/           — Drizzle ORM schema & database client
  env/          — Type-safe environment variables (server/client)
  utils/        — Shared utility helpers
  billing/      — Subscription and billing logic
  connectors/   — Integration connector registry
  logger/       — Shared logging helpers
  lor/          — Lor agent runtime
  messaging/    — Message and channel domain logic
  realtime-types/ — Shared realtime event types
  voice/        — Voice channel support
  typescript-config/ — Shared TypeScript configs
```

## Getting Started

```sh
# Install dependencies
pnpm install

# Copy env file and fill in values
cp .env.example .env

# Push database schema
pnpm db:push

# Start all apps in dev mode
pnpm dev
```

For the bundled Docker Compose services, set `POSTGRES_PASSWORD` and
`REDIS_PASSWORD` in `.env` to separate random, URL-safe passwords (for example,
generate each with `openssl rand -hex 32`). Database and Redis host ports bind
only to `127.0.0.1`; apps running on the host must use matching credentials in
`DATABASE_URL` and `REDIS_URL`. An existing Postgres volume retains its database
password: rotate that role's password before changing the Compose credential.

Before opening a pull request, run the same static gate used by CI:

```sh
pnpm validate
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps and packages |
| `pnpm validate` | Run the contributor gate: Biome, TypeScript, and tests |
| `pnpm check` | Run Biome linting and formatting checks |
| `pnpm check:fix` | Auto-fix Biome issues |
| `pnpm check-types` | Run TypeScript type checking across the workspace |
| `pnpm test` | Run package test suites |
| `pnpm db:push` | Push Drizzle schema to database |
| `pnpm db:studio` | Open Drizzle Studio |

## License

AGPL-3.0
