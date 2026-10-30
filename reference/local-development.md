# Local development

This guide runs the web app and backend processes on your machine, with
PostgreSQL and Redis in Docker. Full agent functionality still uses external
services. It does not describe a complete production deployment.

## Prerequisites

- Node.js 24 and pnpm 9 (the root `package.json` pins pnpm 9.0.0).
- Docker with Compose, for PostgreSQL 16 with pgvector and Redis 7.
- A Vercel AI Gateway key, an S3-compatible bucket, and a Resend key/sender.
- A Blaxel workspace and API key for running agent sessions and app previews.

## Configure your checkout

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env` before starting services. Use your own development accounts and
database. The environment schemas in
[`packages/env/src/server.ts`](../packages/env/src/server.ts) and
[`server-fields.ts`](../packages/env/src/server-fields.ts) are authoritative.

| Variables | Configuration |
| --- | --- |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Generate separate URL-safe passwords with `openssl rand -hex 32`. |
| `DATABASE_URL` | For Compose: `postgresql://lor:YOUR_POSTGRES_PASSWORD@localhost:5432/lor`. |
| `REDIS_URL` | For Compose: `redis://:YOUR_REDIS_PASSWORD@localhost:6379`. |
| `BETTER_AUTH_SECRET` | Generate a separate random secret with `openssl rand -hex 32`. |
| `AI_GATEWAY_API_KEY` | Your Vercel AI Gateway key; required by backend configuration even when using other model access. |
| `S3_*` | Your storage endpoint, credentials, bucket, region, and public asset base URL. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Your Resend key and an authorized sender for account emails. |
| `BL_API_KEY`, `BL_WORKSPACE` | Set together to enable Blaxel agent sandboxes. |
| `INTEGRATION_ENCRYPTION_KEY` | A separate 64-character hex key for stored connector/provider credentials; generate with `openssl rand -hex 32`. |

Keep `NODE_ENV=development`, `LOR_HOSTED_BETA=false`, and the localhost app,
API, and realtime URLs from the example. Leave Autumn billing credentials
unset for development. `NEXT_PUBLIC_SELF_HOSTED` does not bypass signup or
configure infrastructure; follow the signup instructions below.

### Local signup

The shared launch configuration disables public signup by default. For a
fresh local instance, set `selfSignups: true` in
[`packages/utils/src/features.ts`](../packages/utils/src/features.ts) and
restart the app processes. Keep this local-only change out of your pull
request. With hosted beta disabled, the flag controls the signup page and
server gate. Existing accounts can still sign in when the flag is off.

### Agent sandboxes and integrations

Agent sessions run in Blaxel, not a local Docker container. Publish the
workbench image from [`packages/lor/sandbox-image`](../packages/lor/sandbox-image)
to your Blaxel workspace and set `LOR_WORKBENCH_IMAGE` to its image reference.
The Dockerfile and `harness-bootstrap.ts` there describe the required
bootstrap and image publishing steps. Without a configured sandbox provider,
starting the web app does not make agent execution available.

Connectors need their own OAuth apps or credentials. Start with the
[connector guide](adding-a-connector.md) and
[GitHub setup reference](github-connector.md). GitHub account linking enables
commits as yourself; code checkpoints also require
`CODE_STORAGE_ORG` and `CODE_STORAGE_PRIVATE_KEY`. Web search is optional
and uses `EXA_API_KEY`.

## Start the services

```sh
docker compose up -d postgres redis
pnpm db:push
pnpm --filter @repo/db exec tsx src/seeds/index.ts
pnpm dev api web realtime worker
```

`db:push` creates required database extensions before applying the schema.
The seed command creates Lor's bot users and is safe to repeat. Compose
database/cache ports bind to localhost; app processes use the matching
credentials in `.env`. Changing `POSTGRES_PASSWORD` does not change the
password inside an existing Postgres volume; update the database role first.

| Service | Local URL |
| --- | --- |
| Web app | http://localhost:3000 |
| API | http://localhost:8080 |
| Realtime | http://localhost:8000 |
| Marketing site (`pnpm dev www`) | http://localhost:3001 |

`pnpm dev` without arguments opens an app picker. The core command above
omits the transcriber because voice is hidden by default. Desktop requires
the Tauri/Rust platform toolchain; mobile has its own
[setup guide](../apps/mobile/README.md).

## Repository map

| Location | Purpose |
| --- | --- |
| `apps/web`, `apps/www` | Main web client and marketing site |
| `apps/api`, `apps/realtime`, `apps/worker` | HTTP API, realtime events, background jobs |
| `apps/desktop`, `apps/mobile`, `apps/transcriber` | Native clients and voice transcription |
| `packages/lor`, `packages/connectors` | Agent runtime and tool integrations |
| `packages/db`, `packages/auth`, `packages/billing` | Persistence, accounts, billing |
| `packages/ui`, `packages/env`, `packages/utils` | Shared components, configuration, utilities |
| `packages/api-client`, `packages/realtime-types` | Shared client contracts |
| `packages/messaging`, `packages/voice`, `packages/logger` | Messaging, voice, logging |
| `packages/typescript-config` | Shared TypeScript configuration |

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Choose development apps interactively |
| `pnpm build` | Build workspace apps and packages |
| `pnpm check` | Check formatting and lint |
| `pnpm check:fix` | Apply formatting and lint fixes; review the diff |
| `pnpm check-types` | Build required dependencies and check workspace types |
| `pnpm db:push` | Apply the database schema to the configured database |
| `pnpm db:studio` | Open Drizzle Studio |

Use the [contributor guide](../CONTRIBUTING.md) for review expectations and
verification policy. The [reference index](README.md) distinguishes shipped
behavior from plans and historical notes.
